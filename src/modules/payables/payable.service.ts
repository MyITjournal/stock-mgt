import { Inject, Injectable } from '@nestjs/common';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { Minor } from '../../common/money/money';
import { LIVE_SUPPLIER_PAYMENTS, billBalance } from './balance';

const MS_PER_DAY = 86_400_000;

export interface OutstandingBill {
  id: string;
  invoiceNumber: string | null;
  issuedAt: Date;
  dueDate: Date | null;
  supplier: { id: string; name: string; phone: string | null };
  amountDue: Minor;
  paid: Minor;
  balance: Minor;
  daysOutstanding: number;
  /** Negative once the intended date has passed. Null when none was set. */
  daysUntilDue: number | null;
}

/**
 * What the business owes, and to whom.
 *
 * The money-out mirror of `ReceivableService.outstanding`, and the same shape on
 * purpose: the web dashboard shows one total, and clicking it opens this list.
 *
 * **A list sorted longest-outstanding-first, not 30/60/90 buckets.** The same
 * call §11 made for receivables, for the same reason: the question an owner
 * actually asks is "who have I owed longest", which is a sort. Buckets can be
 * added the day somebody asks to read them.
 */
@Injectable()
export class PayableService {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma) {}

  async outstanding(filter: { supplierId?: string } = {}) {
    const bills = await this.prisma.supplierBill.findMany({
      where: {
        deletedAt: null,
        ...(filter.supplierId && { supplierId: filter.supplierId }),
      },
      orderBy: [{ issuedAt: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        invoiceNumber: true,
        issuedAt: true,
        dueDate: true,
        amountDue: true,
        supplier: { select: { id: true, name: true, phone: true } },
        payments: LIVE_SUPPLIER_PAYMENTS,
      },
    });

    const now = Date.now();
    const outstanding: OutstandingBill[] = bills
      .map((bill) => ({
        id: bill.id,
        invoiceNumber: bill.invoiceNumber,
        issuedAt: bill.issuedAt,
        dueDate: bill.dueDate,
        supplier: bill.supplier,
        amountDue: bill.amountDue,
        ...billBalance(bill),
        daysOutstanding: Math.floor(
          (now - bill.issuedAt.getTime()) / MS_PER_DAY,
        ),
        daysUntilDue: bill.dueDate
          ? Math.floor((bill.dueDate.getTime() - now) / MS_PER_DAY)
          : null,
      }))
      // A settled bill is history, not a payable. It stays readable through
      // `GET /supplier-bills`, which is where the audit trail belongs.
      .filter((bill) => bill.balance !== 0);

    return {
      bills: outstanding,
      bySupplier: groupBySupplier(outstanding),
      /**
       * The headline figure: everything still owed to every vendor. This is
       * the number the dashboard shows and the one a click drills into.
       */
      total: outstanding.reduce((sum, bill) => sum + bill.balance, 0),
      /** How many vendors are owed anything at all. */
      suppliers: new Set(outstanding.map((bill) => bill.supplier.id)).size,
      /** The longest anything has gone unpaid, in days. Null when nothing is. */
      oldestDays: outstanding.reduce<number | null>(
        (oldest, bill) =>
          oldest === null || bill.daysOutstanding > oldest
            ? bill.daysOutstanding
            : oldest,
        null,
      ),
      /**
       * Owed and already past the date the business said it would pay. Only
       * counts bills that were given a date, since most are not.
       */
      overdue: outstanding
        .filter((bill) => bill.daysUntilDue !== null && bill.daysUntilDue < 0)
        .reduce((sum, bill) => sum + bill.balance, 0),
    };
  }

  /**
   * One vendor's position: what is still owed, and what has been paid.
   *
   * The mirror of a customer statement, and what somebody reads out when a
   * vendor rings to chase.
   */
  async statement(supplierId: string) {
    const [owing, payments] = await Promise.all([
      this.outstanding({ supplierId }),
      this.prisma.supplierPayment.findMany({
        where: { supplierId, voidedAt: null },
        orderBy: [{ occurredAt: 'asc' }],
        select: {
          id: true,
          amount: true,
          method: true,
          reference: true,
          occurredAt: true,
          bill: { select: { id: true, invoiceNumber: true } },
        },
      }),
    ]);

    return {
      supplierId,
      bills: owing.bills,
      payments,
      totalOwed: owing.total,
      totalPaid: payments.reduce((sum, row) => sum + row.amount, 0),
    };
  }
}

function groupBySupplier(bills: OutstandingBill[]) {
  const grouped = new Map<
    string,
    {
      supplier: { id: string; name: string; phone: string | null };
      balance: Minor;
      bills: number;
      oldestDays: number;
    }
  >();

  for (const bill of bills) {
    const row = grouped.get(bill.supplier.id) ?? {
      supplier: bill.supplier,
      balance: 0,
      bills: 0,
      oldestDays: 0,
    };

    row.balance += bill.balance;
    row.bills += 1;
    row.oldestDays = Math.max(row.oldestDays, bill.daysOutstanding);
    grouped.set(bill.supplier.id, row);
  }

  // Largest debt first: the breakdown behind a total is read to decide who to
  // pay next, and that decision starts at the top of the list.
  return [...grouped.values()].sort((a, b) => b.balance - a.balance);
}
