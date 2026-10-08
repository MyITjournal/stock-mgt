import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { shopMoney } from '../../common/money/shop-money';
import { dueDateFor } from './due';
import { CorrectSaleDto } from './dto/correct-sale.dto';
import { SaleCorrectionPreviewView, SaleView } from './dto/sale.response';
import { planSaleCorrection, type PaymentOnSale } from './sale-correction';
import { SaleService } from './sale.service';

/**
 * `POST /sales/:id/corrections` — a recorded sale put right: the prices really
 * charged, the customer it really was, or both. The rules are in
 * `sale-correction.ts`; this is the writing.
 *
 * Everything moves in one transaction or nothing does: the lines, the sale,
 * the payment brought down with a lower total, the payments that move to the
 * right customer, and the correction record keeping what it all said before.
 */
@Injectable()
export class SaleCorrectionService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma,
    private readonly sales: SaleService,
  ) {}

  async correct(saleId: string, input: CorrectSaleDto): Promise<SaleView> {
    // The id is what is stable across a retry (each attempt gets a fresh
    // Idempotency-Key): one already recorded means this is that correction
    // arriving again, not a second one.
    const already =
      input.id &&
      (await this.prisma.saleCorrection.findFirst({
        where: { id: input.id, saleId },
        select: { id: true },
      }));
    if (!already) await this.apply(saleId, input, false);
    return this.sales.findOne(saleId);
  }

  /**
   * What a correction would do, without doing it: **the real correction, run
   * and rolled back**, so the preview meets every refusal the save would and
   * the dialog shows the server's figures rather than working out money.
   */
  async preview(
    saleId: string,
    input: CorrectSaleDto,
  ): Promise<SaleCorrectionPreviewView> {
    try {
      await this.apply(saleId, input, true);
    } catch (error) {
      if (error instanceof RolledBack) return error.preview;
      throw error;
    }
    throw new Error('A preview must roll back.');
  }

  private async apply(
    saleId: string,
    input: CorrectSaleDto,
    dryRun: boolean,
  ): Promise<void> {
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.get()?.userId ?? null;
    const reason = input.reason.trim();

    await this.prisma.$transaction(
      async (tx) => {
        const sale = await tx.sale.findFirst({
          where: { id: saleId },
          select: {
            id: true,
            number: true,
            customerId: true,
            total: true,
            taxTotal: true,
            occurredAt: true,
            dueDate: true,
            lines: {
              select: {
                id: true,
                quantity: true,
                unitPrice: true,
                lineTotal: true,
                taxRateBps: true,
                taxAmount: true,
              },
            },
            returns: { select: { refundAmount: true } },
            allocations: {
              select: {
                amount: true,
                payment: {
                  select: {
                    id: true,
                    amount: true,
                    voidedAt: true,
                    occurredAt: true,
                    allocations: { select: { saleId: true } },
                  },
                },
              },
            },
          },
        });
        if (!sale) throw new NotFoundException('Sale not found');

        if (input.customerId && input.customerId !== sale.customerId) {
          const customer = await tx.customer.findFirst({
            where: { id: input.customerId, deletedAt: null },
            select: { id: true },
          });
          if (!customer) throw new NotFoundException('Customer not found');
        }

        // Each payment once, with how much of it is on this sale.
        const payments = new Map<string, PaymentOnSale>();
        for (const allocation of sale.allocations) {
          const payment = allocation.payment;
          const seen = payments.get(payment.id);
          if (seen) {
            seen.allocatedHere += allocation.amount;
            continue;
          }
          payments.set(payment.id, {
            id: payment.id,
            amount: payment.amount,
            allocatedHere: allocation.amount,
            allocatedElsewhere: payment.allocations.some(
              (row) => row.saleId !== sale.id,
            ),
            voided: payment.voidedAt !== null,
            occurredAt: payment.occurredAt,
          });
        }

        const plan = planSaleCorrection(
          {
            customerId: sale.customerId,
            total: sale.total,
            taxTotal: sale.taxTotal,
            lines: sale.lines,
            hasReturns: sale.returns.length > 0,
            payments: [...payments.values()],
          },
          { customerId: input.customerId, lines: input.lines },
          await shopMoney(tx),
        );
        if (plan.refused) {
          throw plan.refused.status === 409
            ? new ConflictException(plan.refused.message)
            : new BadRequestException(plan.refused.message);
        }

        // The lines and the sale: the true figures.
        for (const change of plan.lineChanges) {
          await tx.saleLine.update({
            where: { id: change.line.id },
            data: {
              unitPrice: change.unitPrice,
              lineTotal: change.lineTotal,
              taxAmount: change.taxAmount,
            },
          });
        }

        const refunded = sale.returns.reduce(
          (sum, row) => sum + row.refundAmount,
          0,
        );
        const balanceAfter = plan.totalAfter - plan.paidAfter - refunded;

        // A sale that now owes and never had a due day gets the one it would
        // have had: five days after the sale, not after the correction.
        let dueDate = sale.dueDate;
        if (balanceAfter > 0 && !dueDate) {
          const { timezone } = await tx.organization.findUniqueOrThrow({
            where: { id: organizationId },
            select: { timezone: true },
          });
          dueDate = dueDateFor(timezone || 'Africa/Lagos', sale.occurredAt);
        }

        await tx.sale.update({
          where: { id: sale.id },
          data: {
            total: plan.totalAfter,
            taxTotal: plan.taxTotalAfter,
            customerId: plan.customerIdAfter,
            dueDate,
          },
        });

        // The payment that claimed more than was taken: voided, and the true
        // amount recorded in its place by the same person, the same way, on
        // the same day — so their cash in hand says what really came in.
        if (plan.follows) {
          const original = await tx.payment.findFirstOrThrow({
            where: { id: plan.follows.paymentId },
          });
          const voided = await tx.payment.updateMany({
            where: { id: original.id, voidedAt: null },
            data: {
              voidedAt: new Date(),
              voidedReason: `Price corrected on ${sale.number}: ${reason}`,
              voidedByUserId: userId,
            },
          });
          if (voided.count !== 1) {
            throw new ConflictException(
              'That payment was changed while the sale was being corrected. Open the sale again and retry.',
            );
          }
          if (plan.follows.amount > 0) {
            const paymentId = randomUUID();
            await tx.payment.create({
              data: {
                id: paymentId,
                organizationId,
                customerId: plan.customerIdAfter,
                locationId: original.locationId,
                amount: plan.follows.amount,
                method: original.method,
                bankAccountId: original.bankAccountId,
                reference: original.reference,
                note: original.note,
                occurredAt: original.occurredAt,
                recordedByUserId: original.recordedByUserId,
              },
            });
            await tx.paymentAllocation.create({
              data: {
                organizationId,
                paymentId,
                saleId: sale.id,
                amount: plan.follows.amount,
              },
            });
          }
        }

        // Payments that settled only this sale go with it to the right
        // customer.
        if (plan.movePaymentIds.length > 0) {
          await tx.payment.updateMany({
            where: { id: { in: plan.movePaymentIds } },
            data: { customerId: plan.customerIdAfter },
          });
        }

        await tx.saleCorrection.create({
          data: {
            ...(input.id && { id: input.id }),
            organizationId,
            saleId: sale.id,
            reason,
            customerIdBefore: sale.customerId,
            customerIdAfter: plan.customerIdAfter,
            totalBefore: sale.total,
            totalAfter: plan.totalAfter,
            paidBefore: plan.paidBefore,
            paidAfter: plan.paidAfter,
            recordedByUserId: userId,
            lines: {
              create: plan.lineChanges.map((change) => ({
                organizationId,
                saleLineId: change.line.id,
                unitPriceBefore: change.line.unitPrice,
                unitPriceAfter: change.unitPrice,
                lineTotalBefore: change.line.lineTotal,
                lineTotalAfter: change.lineTotal,
              })),
            },
          },
        });

        if (dryRun) {
          const after = plan.customerIdAfter
            ? await tx.customer.findFirst({
                where: { id: plan.customerIdAfter },
                select: { firstName: true, lastName: true },
              })
            : null;
          throw new RolledBack({
            totalBefore: sale.total,
            totalAfter: plan.totalAfter,
            taxTotalAfter: plan.taxTotalAfter,
            paidBefore: plan.paidBefore,
            paidAfter: plan.paidAfter,
            balanceAfter,
            paymentFollows: plan.follows !== null,
            customerAfter: after
              ? [after.firstName, after.lastName].filter(Boolean).join(' ')
              : null,
            customerChanged: plan.customerChanged,
            paymentsMoved: plan.movePaymentIds.length,
            lines: plan.lineChanges.map((change) => ({
              lineId: change.line.id,
              lineTotalBefore: change.line.lineTotal,
              lineTotalAfter: change.lineTotal,
            })),
          });
        }
      },
      { timeout: 30_000 },
    );
  }
}

/** Carries a preview out of a transaction it has just rolled back. */
class RolledBack extends Error {
  constructor(readonly preview: SaleCorrectionPreviewView) {
    super('Preview rolled back');
  }
}
