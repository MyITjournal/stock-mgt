import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PaymentMethod } from '@prisma/client';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import {
  SYNC_LAG_MS,
  decodeCursor,
  encodeCursor,
  keysetWhereUpdated,
} from '../../common/pagination/keyset-cursor';
import {
  AllocationRequest,
  AllocationResult,
  allocateOldest,
  planAllocations,
} from './allocation';
import { LIVE_ALLOCATIONS, saleBalance } from './balance';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { VoidPaymentDto } from './dto/void-payment.dto';

/** How many payments one page returns when the caller does not say. */
const DEFAULT_PAGE = 100;
const MAX_PAGE = 500;

export interface PaymentQuery {
  customerId?: string;
  since?: Date;
  cursor?: string;
  limit?: number;
}

const PAYMENT_INCLUDE = {
  customer: {
    select: { id: true, firstName: true, lastName: true, phone: true },
  },
  location: { select: { id: true, name: true } },
  recordedBy: { select: { id: true, firstName: true, lastName: true } },
  voidedBy: { select: { id: true, firstName: true, lastName: true } },
  // Unfiltered on purpose: a voided payment still shows what it *had* claimed,
  // which is the point of keeping the row. The filtering happens where a
  // balance is computed, via `LIVE_ALLOCATIONS`.
  allocations: {
    include: { sale: { select: { id: true, number: true, total: true } } },
  },
} as const;

/**
 * Money in, and money handed back.
 *
 * A payment is **one row per thing that happened**: a ₦50,000 transfer is one
 * payment even when it settles three invoices, because that is the number on
 * the bank statement someone will one day reconcile against. Which invoices it
 * answered is a separate claim, recorded in `PaymentAllocation`.
 *
 * The amount is signed — positive in, negative back out — following
 * `StockMovement.quantity`. A customer's position is then a plain sum with no
 * branch on type, and a refund needs no separate table.
 */
@Injectable()
export class PaymentService {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma) {}

  async create(input: CreatePaymentDto) {
    if (input.amount === 0) {
      throw new BadRequestException('A payment of zero records nothing');
    }
    if (input.customerId) await this.assertCustomerExists(input.customerId);
    if (input.locationId) await this.assertLocationExists(input.locationId);

    const paymentId = input.id ?? randomUUID();
    const occurredAt = input.occurredAt
      ? new Date(input.occurredAt)
      : new Date();
    const organizationId = TenantContext.requireOrganizationId();
    const recordedByUserId = TenantContext.get()?.userId ?? null;

    // What the caller is allowed to settle: the invoices they named, or every
    // outstanding one for this customer when they left it to us.
    const named = input.allocations?.map((row) => row.saleId);
    const outstanding = await this.outstandingFor(input.customerId, named);

    let requested: AllocationRequest[];
    if (input.allocations?.length) {
      requested = input.allocations.map((row) => ({
        saleId: row.saleId,
        amount: row.amount,
      }));
    } else {
      // Nobody said, so oldest first — the only ordering anyone means by
      // "put it against my account".
      requested = allocateOldest(input.amount, outstanding);
    }

    let plan: AllocationResult;
    try {
      plan = planAllocations(input.amount, requested, outstanding);
    } catch (error) {
      // The pure layer speaks in RangeError; the API speaks in 409.
      throw new ConflictException(
        error instanceof Error ? error.message : 'Allocation is not valid',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          id: paymentId,
          organizationId,
          customerId: input.customerId ?? null,
          locationId: input.locationId ?? null,
          amount: input.amount,
          method: input.method ?? PaymentMethod.cash,
          reference: input.reference ?? null,
          note: input.note ?? null,
          occurredAt,
          recordedByUserId,
        },
      });

      if (plan.allocations.length > 0) {
        await tx.paymentAllocation.createMany({
          data: plan.allocations.map((row) => ({
            organizationId,
            paymentId,
            saleId: row.saleId,
            amount: row.amount,
          })),
        });
      }
    });

    return this.findOne(paymentId);
  }

  /**
   * The invoices a payment may be put against, oldest first.
   *
   * Scoped to the customer when there is one. A walk-in refund names its sale
   * explicitly, so `saleIds` covers the case where there is no account to look
   * the invoice up on.
   */
  private async outstandingFor(customerId?: string, saleIds?: string[]) {
    const sales = await this.prisma.sale.findMany({
      where: {
        ...(saleIds?.length
          ? { id: { in: saleIds } }
          : { customerId: customerId ?? undefined }),
      },
      orderBy: [{ occurredAt: 'asc' }, { number: 'asc' }],
      select: {
        id: true,
        total: true,
        allocations: LIVE_ALLOCATIONS,
        returns: { select: { refundAmount: true } },
      },
    });

    return sales
      .map((sale) => ({ saleId: sale.id, balance: saleBalance(sale).balance }))
      .filter((row) => row.balance !== 0);
  }

  /**
   * Payments, paged by keyset — **on `updatedAt`, not `createdAt`**.
   *
   * A payment is the first row in this system that can change after it is
   * written: voiding one leaves `createdAt` alone. Ordered by `createdAt`, a
   * client that had already synced that payment would never hear it was voided
   * and would go on showing the invoice as settled. Ordering by `updatedAt`
   * sends it again the moment it changes.
   *
   * The cost is that a client can be handed a row it already has, so clients
   * must upsert by id rather than append. That is the right trade: a duplicate
   * is a no-op, a missed void is money the business does not have.
   */
  async findAll(query: PaymentQuery = {}) {
    const limit = Math.min(query.limit ?? DEFAULT_PAGE, MAX_PAGE);
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const syncedThrough = new Date(Date.now() - SYNC_LAG_MS);

    const rows = await this.prisma.payment.findMany({
      where: {
        ...(query.customerId && { customerId: query.customerId }),
        AND: [
          { updatedAt: { lte: syncedThrough } },
          ...keysetWhereUpdated(cursor, query.since),
        ],
      },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: limit,
      include: PAYMENT_INCLUDE,
    });

    const last = rows.at(-1);

    return {
      payments: rows.map(withUnallocated),
      nextCursor:
        rows.length === limit && last
          ? encodeCursor({ at: last.updatedAt, id: last.id })
          : null,
      syncedThrough,
      hasMore: rows.length === limit,
    };
  }

  async findOne(id: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id },
      include: PAYMENT_INCLUDE,
    });
    if (!payment) throw new NotFoundException('Payment not found');
    return withUnallocated(payment);
  }

  /**
   * Marks a payment as one that should never have existed.
   *
   * This is **not** how a refund is recorded. Money genuinely handed back is a
   * negative `Payment`, because it is a thing that happened and the bank
   * statement will show it. Voiding says the opposite: the money never moved,
   * and the row is a data-entry mistake — a mis-keyed amount, or a collection
   * booked against the wrong customer.
   *
   * The row is kept and the allocations are left attached, so the mistake and
   * its correction are both legible afterwards. What changes is that nothing
   * downstream counts it: `LIVE_ALLOCATIONS` drops it out of every balance, so
   * the invoices it had settled go back to being owed.
   */
  async voidPayment(id: string, input: VoidPaymentDto) {
    const payment = await this.findOne(id);

    if (payment.voidedAt) {
      throw new ConflictException(
        'This payment is already voided. Voiding it twice would suggest two mistakes where there was one.',
      );
    }

    await this.prisma.payment.update({
      where: { id },
      data: {
        voidedAt: new Date(),
        voidedReason: input.reason.trim(),
        voidedByUserId: TenantContext.get()?.userId ?? null,
      },
    });

    return this.findOne(id);
  }

  private async assertCustomerExists(id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, deletedAt: null },
    });
    if (!customer) throw new NotFoundException('Customer not found');
  }

  private async assertLocationExists(id: string) {
    const location = await this.prisma.location.findFirst({
      where: { id, deletedAt: null },
    });
    if (!location) throw new NotFoundException('Location not found');
  }
}

/**
 * What of this payment was not claimed against an invoice — the customer's
 * credit, waiting for the next one. Derived, so it cannot drift from the
 * allocations it is the remainder of.
 */
function withUnallocated<
  T extends { amount: number; allocations: { amount: number }[] },
>(payment: T) {
  const allocated = payment.allocations.reduce(
    (total, row) => total + row.amount,
    0,
  );
  return { ...payment, allocated, unallocated: payment.amount - allocated };
}
