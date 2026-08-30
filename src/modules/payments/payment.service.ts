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
  keysetWhere,
} from '../../common/pagination/keyset-cursor';
import {
  AllocationRequest,
  AllocationResult,
  allocateOldest,
  planAllocations,
} from './allocation';
import { saleBalance } from './balance';
import { CreatePaymentDto } from './dto/create-payment.dto';

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
  recordedBy: { select: { id: true, firstName: true, lastName: true } },
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
        allocations: { select: { amount: true } },
        returns: { select: { refundAmount: true } },
      },
    });

    return sales
      .map((sale) => ({ saleId: sale.id, balance: saleBalance(sale).balance }))
      .filter((row) => row.balance !== 0);
  }

  /** Payments, paged by keyset the same way sales and the ledger are. */
  async findAll(query: PaymentQuery = {}) {
    const limit = Math.min(query.limit ?? DEFAULT_PAGE, MAX_PAGE);
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const syncedThrough = new Date(Date.now() - SYNC_LAG_MS);

    const rows = await this.prisma.payment.findMany({
      where: {
        ...(query.customerId && { customerId: query.customerId }),
        AND: [
          { createdAt: { lte: syncedThrough } },
          ...keysetWhere(cursor, query.since),
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
      include: PAYMENT_INCLUDE,
    });

    const last = rows.at(-1);

    return {
      payments: rows.map(withUnallocated),
      nextCursor:
        rows.length === limit && last
          ? encodeCursor({ createdAt: last.createdAt, id: last.id })
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

  private async assertCustomerExists(id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, deletedAt: null },
    });
    if (!customer) throw new NotFoundException('Customer not found');
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
