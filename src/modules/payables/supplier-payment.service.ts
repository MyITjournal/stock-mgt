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
  keysetWhereUpdatedDesc,
} from '../../common/pagination/keyset-cursor';
import { BankAccountService } from '../payments/bank-account.service';
import { SupplierBillService } from './supplier-bill.service';
import {
  CreateSupplierPaymentDto,
  VoidSupplierPaymentDto,
} from './dto/supplier-payment.dto';
import {
  SupplierPaymentListView,
  SupplierPaymentView,
} from './dto/payables.response';

const DEFAULT_PAGE = 50;
const MAX_PAGE = 200;

const PAYMENT_INCLUDE = {
  supplier: { select: { id: true, name: true } },
  bill: {
    select: {
      id: true,
      invoiceNumber: true,
      amountDue: true,
      issuedAt: true,
    },
  },
  bankAccount: {
    select: { id: true, bankName: true, accountName: true },
  },
  recordedBy: { select: { id: true, firstName: true, lastName: true } },
} as const;

/**
 * Money going out to vendors.
 *
 * Structurally the mirror of `PaymentService`, with one deliberate difference:
 * a payment names its bill directly rather than carrying allocations. Vendors
 * here are paid on delivery or against one specific supply, so the join table
 * would be a row per payment with nothing in it. §11's rule still holds in the
 * form that matters — **which debt a payment answered is recorded, never
 * inferred.**
 */
@Injectable()
export class SupplierPaymentService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma,
    private readonly bills: SupplierBillService,
    private readonly bankAccounts: BankAccountService,
  ) {}

  async create(input: CreateSupplierPaymentDto): Promise<SupplierPaymentView> {
    if (input.amount === 0) {
      throw new BadRequestException('A payment of zero records nothing');
    }

    const method = input.method ?? PaymentMethod.cash;
    const bankAccountId = await this.bankAccounts.resolveForPayment(
      method,
      input.bankAccountId,
    );

    const payment = await this.prisma.$transaction(async (tx) => {
      // Read inside the transaction: two payments racing to settle the last of
      // a bill would otherwise both see the full balance and both be allowed.
      const bill = await this.bills.balanceOf(input.billId, tx);

      if (input.amount > bill.balance) {
        throw new ConflictException(
          `This bill has ${bill.balance} outstanding and you are paying ${input.amount}. Paying a vendor more than they are owed is not something this records — correct the bill's amountDue if the invoice was higher than entered.`,
        );
      }

      return tx.supplierPayment.create({
        data: {
          ...(input.id && { id: input.id }),
          organizationId: TenantContext.requireOrganizationId(),
          billId: bill.id,
          // Copied from the bill rather than taken from the caller, so the two
          // can never disagree about which vendor was paid.
          supplierId: bill.supplierId,
          amount: input.amount,
          method,
          bankAccountId,
          reference: input.reference ?? null,
          note: input.note ?? null,
          occurredAt: input.occurredAt
            ? new Date(input.occurredAt)
            : new Date(),
          recordedByUserId: TenantContext.get()?.userId ?? null,
        },
        include: PAYMENT_INCLUDE,
      });
    });

    return payment;
  }

  /**
   * Writes the payment a delivery was settled with, inside the caller's
   * transaction.
   *
   * Used by `POST /goods-receipts` so recording a delivery and what was handed
   * over is one request. Skips the balance check the public path does, because
   * the bill was created microseconds earlier by the same transaction and its
   * balance is known — the caller checks the amount against the bill total
   * before calling.
   */
  async recordForDelivery(
    tx: Pick<TenantPrisma, 'supplierPayment'>,
    input: {
      billId: string;
      supplierId: string;
      amount: number;
      method: PaymentMethod;
      bankAccountId: string | null;
      reference?: string;
      occurredAt: Date;
    },
  ) {
    return tx.supplierPayment.create({
      data: {
        id: randomUUID(),
        organizationId: TenantContext.requireOrganizationId(),
        billId: input.billId,
        supplierId: input.supplierId,
        amount: input.amount,
        method: input.method,
        bankAccountId: input.bankAccountId,
        reference: input.reference ?? null,
        occurredAt: input.occurredAt,
        recordedByUserId: TenantContext.get()?.userId ?? null,
      },
    });
  }

  /**
   * Says the payment never happened — a mis-key, the wrong vendor.
   *
   * The row is kept and stops counting, so the bill goes back to owing. This is
   * the only correction available here: money genuinely coming back from a
   * vendor would be a negative payment, and this business does not have that
   * case (see the schema note on `SupplierPayment.amount`).
   */
  async void(
    id: string,
    input: VoidSupplierPaymentDto,
  ): Promise<SupplierPaymentView> {
    const payment = await this.prisma.supplierPayment.findFirst({
      where: { id },
    });
    if (!payment) throw new NotFoundException('Supplier payment not found');

    if (payment.voidedAt) {
      throw new ConflictException('This payment is already voided');
    }

    return this.prisma.supplierPayment.update({
      where: { id },
      data: {
        voidedAt: new Date(),
        voidedReason: input.reason.trim(),
        voidedByUserId: TenantContext.get()?.userId ?? null,
      },
      include: PAYMENT_INCLUDE,
    });
  }

  /**
   * Payments out, paged for delta sync.
   *
   * On `updatedAt`, not `createdAt`: voiding one mutates the row, and a client
   * that already synced it has to hear about that or it goes on showing a bill
   * as settled. §8, and the reason `keysetWhereUpdated` exists.
   */
  async findAll(
    query: {
      supplierId?: string;
      billId?: string;
      since?: Date;
      cursor?: string;
      limit?: number;
      /** `asc` syncs, `desc` is for a person reading. See below. */
      order?: 'asc' | 'desc';
    } = {},
  ): Promise<SupplierPaymentListView> {
    const limit = Math.min(query.limit ?? DEFAULT_PAGE, MAX_PAGE);
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const browsing = query.order === 'desc';
    const syncedThrough = new Date(Date.now() - SYNC_LAG_MS);

    const rows = await this.prisma.supplierPayment.findMany({
      where: {
        ...(query.supplierId && { supplierId: query.supplierId }),
        ...(query.billId && { billId: query.billId }),
        AND: [
          // Browsing skips the one-second lag, for the reason set out in
          // `keyset-cursor.ts`: the lag protects a forward-walking cursor from
          // stepping over a row that was still committing, and a reader going
          // backward from the newest row has no such exposure. Leaving it on
          // makes a payment just recorded missing from the list that refetches.
          ...(browsing ? [] : [{ updatedAt: { lte: syncedThrough } }]),
          ...(browsing
            ? keysetWhereUpdatedDesc(cursor)
            : keysetWhereUpdated(cursor, query.since)),
        ],
      },
      orderBy: browsing
        ? [{ updatedAt: 'desc' }, { id: 'desc' }]
        : [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: limit,
      include: PAYMENT_INCLUDE,
    });

    const last = rows.at(-1);

    return {
      payments: rows,
      nextCursor:
        rows.length === limit && last
          ? encodeCursor({ at: last.updatedAt, id: last.id })
          : null,
      syncedThrough,
      hasMore: rows.length === limit,
    };
  }

  async findOne(id: string): Promise<SupplierPaymentView> {
    const payment = await this.prisma.supplierPayment.findFirst({
      where: { id },
      include: PAYMENT_INCLUDE,
    });
    if (!payment) throw new NotFoundException('Supplier payment not found');
    return payment;
  }
}
