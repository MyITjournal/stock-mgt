import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { StockAdjustmentReason, StockMovementType } from '@prisma/client';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { SupplierBillService } from '../payables/supplier-bill.service';
import { StockService, type StockWriter } from './stock.service';
import { ReceivingService } from './receiving.service';
import { CorrectDeliveryDto } from './dto/delivery-correction.dto';
import {
  CorrectionPreviewView,
  GoodsReceiptView,
} from './dto/goods-receipt.response';
import { displayUnit, planCorrection } from './delivery-correction';

/**
 * `POST /goods-receipts/:id/corrections` — a recorded delivery put right.
 *
 * Everything moves in one transaction or nothing does: the stock difference
 * on each line's own lot, the lot's figures, the line's figures, the bill, and
 * the correction record holding what the figures were before. The rules are
 * in `delivery-correction.ts`; this is the writing.
 *
 * Two things stay as they were on purpose. **Sales already made keep their
 * cost** — every money figure on a sale is a snapshot (§6). And the movement
 * carries the delivery's own date, so the month's purchases and vendor
 * targets read the corrected figures while `createdAt` still says when the
 * correction was made.
 */
@Injectable()
export class DeliveryCorrectionService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma,
    private readonly stock: StockService,
    private readonly receiving: ReceivingService,
    private readonly bills: SupplierBillService,
  ) {}

  async correct(
    receiptId: string,
    input: CorrectDeliveryDto,
  ): Promise<GoodsReceiptView> {
    await this.apply(receiptId, input, false);
    return this.receiving.findOne(receiptId);
  }

  /**
   * What a correction would do, without doing it: **the real correction, run
   * and rolled back.** Not a second set of rules that could drift — the same
   * transaction meets the same checks, including the 409 when fewer arrived
   * than have already been sold, and the bill that would drop below what has
   * been paid. So the preview cannot promise what the save refuses.
   */
  async preview(
    receiptId: string,
    input: CorrectDeliveryDto,
  ): Promise<CorrectionPreviewView> {
    try {
      await this.apply(receiptId, input, true);
    } catch (error) {
      if (error instanceof RolledBack) return error.preview;
      throw error;
    }
    throw new Error('A preview must roll back.');
  }

  private async apply(
    receiptId: string,
    input: CorrectDeliveryDto,
    dryRun: boolean,
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        const writer = tx as unknown as StockWriter;
        const receipt = await tx.goodsReceipt.findFirst({
          where: { id: receiptId },
          select: {
            id: true,
            locationId: true,
            receivedAt: true,
            lines: {
              select: {
                id: true,
                productId: true,
                batchId: true,
                unitFactor: true,
                quantityReceived: true,
                quantityPaidFor: true,
                totalCost: true,
              },
            },
          },
        });
        if (!receipt) throw new NotFoundException('Delivery not found');

        const plan = planCorrection(receipt.lines, input.lines);
        if (plan.problems.length > 0) {
          throw new BadRequestException(plan.problems.join(' '));
        }

        // The bill follows the value, never below what has gone against it.
        const bill = await tx.supplierBill.findFirst({
          where: { goodsReceiptId: receipt.id, deletedAt: null },
          select: { id: true, amountDue: true },
        });
        let billAmountAfter: number | null = null;
        if (bill && plan.valueDelta !== 0) {
          const current = await this.bills.balanceOf(bill.id, tx);
          billAmountAfter = bill.amountDue + plan.valueDelta;
          const settled = current.paid + current.rebated;
          if (billAmountAfter < settled) {
            throw new ConflictException(
              `The corrected bill would be ${naira(billAmountAfter)}, but ${naira(settled)} has already been paid or credited against it. Void the payment that was too much first, then correct the delivery.`,
            );
          }
          await tx.supplierBill.update({
            where: { id: bill.id },
            data: { amountDue: billAmountAfter },
          });
        }

        for (const change of plan.changes) {
          // Stock: the difference, on the line's own lot.
          if (change.stockDelta < 0) {
            await this.stock.recordOutbound(
              {
                productId: change.line.productId,
                locationId: receipt.locationId,
                batchId: change.line.batchId,
                quantity: -change.stockDelta,
                type: StockMovementType.adjustment,
                reason: StockAdjustmentReason.receipt_correction,
                note: input.reason,
                occurredAt: receipt.receivedAt,
                referenceType: 'goods_receipt',
                referenceId: receipt.id,
                force: input.force,
                forcedReason: input.forcedReason,
              },
              writer,
            );
          } else if (change.stockDelta > 0) {
            await this.stock.recordInbound(
              {
                productId: change.line.productId,
                locationId: receipt.locationId,
                batchId: change.line.batchId,
                quantity: change.stockDelta,
                type: StockMovementType.adjustment,
                reason: StockAdjustmentReason.receipt_correction,
                note: input.reason,
                occurredAt: receipt.receivedAt,
                referenceType: 'goods_receipt',
                referenceId: receipt.id,
              },
              writer,
            );
          }

          // The lot: its true figures, so value and the cost of later sales
          // are right.
          await tx.stockBatch.update({
            where: { id: change.line.batchId },
            data: {
              quantityReceived: change.received,
              quantityPaidFor: change.paidFor,
              totalCost: change.totalCost,
            },
          });

          // The line: shown in the biggest unit both figures are whole in —
          // 6½ cartons as 91 pieces, 7 cartons as 7 cartons again.
          const units = await tx.productUnit.findMany({
            where: { productId: change.line.productId },
            select: { id: true, name: true, factor: true },
          });
          const unit = displayUnit(change, units);
          await tx.goodsReceiptLine.update({
            where: { id: change.line.id },
            data: {
              quantityReceived: change.received,
              quantityPaidFor: change.paidFor,
              totalCost: change.totalCost,
              unitId: unit.id,
              unitFactor: unit.factor,
              quantityReceivedInUnit: change.received / unit.factor,
              quantityPaidForInUnit: change.paidFor / unit.factor,
            },
          });

          await this.refreshCostPrice(
            tx,
            change.line.productId,
            change.line.id,
          );
        }

        await tx.goodsReceiptCorrection.create({
          data: {
            organizationId: TenantContext.requireOrganizationId(),
            receiptId: receipt.id,
            reason: input.reason.trim(),
            billAmountBefore:
              bill && billAmountAfter !== null ? bill.amountDue : null,
            billAmountAfter,
            recordedByUserId: TenantContext.get()?.userId ?? null,
            lines: {
              create: plan.changes.map((change) => ({
                organizationId: TenantContext.requireOrganizationId(),
                receiptLineId: change.line.id,
                receivedBefore: change.line.quantityReceived,
                receivedAfter: change.received,
                paidForBefore: change.line.quantityPaidFor,
                paidForAfter: change.paidFor,
                totalCostBefore: change.line.totalCost,
                totalCostAfter: change.totalCost,
              })),
            },
          },
        });

        if (dryRun) {
          throw new RolledBack({
            valueDelta: plan.valueDelta,
            billAmountBefore: bill ? bill.amountDue : null,
            billAmountAfter: bill ? (billAmountAfter ?? bill.amountDue) : null,
            lines: plan.changes.map((change) => ({
              lineId: change.line.id,
              stockDelta: change.stockDelta,
            })),
          });
        }
      },
      { timeout: 30_000 },
    );
  }

  /**
   * The cost-price display, as a delivery writes it — but only when this line
   * is still the product's latest delivery, or a correction to an old delivery
   * would overwrite what a newer one set. A display only; never a valuation
   * input (§2).
   */
  private async refreshCostPrice(
    tx: Pick<TenantPrisma, 'goodsReceiptLine' | 'product'>,
    productId: string,
    lineId: string,
  ) {
    const latest = await tx.goodsReceiptLine.findFirst({
      where: { productId },
      orderBy: [{ receipt: { receivedAt: 'desc' } }, { createdAt: 'desc' }],
      select: { id: true, totalCost: true, quantityReceived: true },
    });
    if (latest?.id !== lineId || latest.quantityReceived === 0) return;
    await tx.product.update({
      where: { id: productId },
      data: {
        costPrice: Math.round(latest.totalCost / latest.quantityReceived),
      },
    });
  }
}

/** For a message a person reads: ₦12,500.00. */
function naira(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Carries a preview out of a transaction it has just rolled back. */
class RolledBack extends Error {
  constructor(readonly preview: CorrectionPreviewView) {
    super('Preview rolled back');
  }
}
