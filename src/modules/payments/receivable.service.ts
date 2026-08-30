import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { saleBalance } from './balance';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * "Who owes me" — one of the three questions the product exists to answer.
 *
 * Deliberately a **list, oldest first**, not a 30/60/90 aging report. Buckets
 * are a convention borrowed from accounting packages; what actually gets used
 * here is "who has owed me longest", which is a sort. Buckets can be added the
 * day somebody asks to read them.
 */
@Injectable()
export class ReceivableService {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma) {}

  /**
   * Every invoice with money still on it, longest outstanding first, plus a
   * total per customer so the list can be read either way round.
   */
  async outstanding(filter: { customerId?: string } = {}) {
    const sales = await this.prisma.sale.findMany({
      where: { ...(filter.customerId && { customerId: filter.customerId }) },
      orderBy: [{ occurredAt: 'asc' }, { number: 'asc' }],
      select: {
        id: true,
        number: true,
        occurredAt: true,
        total: true,
        customer: {
          select: { id: true, firstName: true, lastName: true, phone: true },
        },
        allocations: { select: { amount: true } },
        returns: { select: { refundAmount: true } },
      },
    });

    const now = Date.now();
    const invoices = sales
      .map((sale) => ({
        id: sale.id,
        number: sale.number,
        occurredAt: sale.occurredAt,
        customer: sale.customer,
        total: sale.total,
        ...saleBalance(sale),
        daysOutstanding: Math.floor(
          (now - sale.occurredAt.getTime()) / MS_PER_DAY,
        ),
      }))
      .filter((sale) => sale.balance !== 0);

    return {
      invoices,
      byCustomer: groupByCustomer(invoices),
      /** Owed to the business. Money owed *back* is excluded, not netted off. */
      totalOutstanding: invoices
        .filter((sale) => sale.balance > 0)
        .reduce((total, sale) => total + sale.balance, 0),
    };
  }

  /**
   * One customer's position: their invoices, their payments, and any credit
   * they are holding from money that was never put against an invoice.
   */
  async statement(customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, phone: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const [{ invoices }, payments] = await Promise.all([
      this.outstanding({ customerId }),
      this.prisma.payment.findMany({
        where: { customerId },
        orderBy: [{ occurredAt: 'asc' }],
        include: { allocations: { select: { amount: true } } },
      }),
    ]);

    const credit = payments.reduce(
      (total, payment) =>
        total +
        payment.amount -
        payment.allocations.reduce((sum, row) => sum + row.amount, 0),
      0,
    );

    return {
      customer,
      invoices,
      payments,
      /** Money received that no invoice has claimed yet. */
      credit,
      owed: invoices.reduce((total, sale) => total + sale.balance, 0),
    };
  }
}

function groupByCustomer(
  invoices: {
    customer: { id: string; firstName: string; lastName: string | null } | null;
    balance: number;
    daysOutstanding: number;
  }[],
) {
  const grouped = new Map<
    string,
    { customer: unknown; balance: number; invoices: number; oldestDays: number }
  >();

  for (const invoice of invoices) {
    // Walk-ins share one bucket: they have no account to chase, but a walk-in
    // invoice can still carry a balance if goods went back after payment.
    const key = invoice.customer?.id ?? 'walk-in';
    const row = grouped.get(key) ?? {
      customer: invoice.customer,
      balance: 0,
      invoices: 0,
      oldestDays: 0,
    };

    row.balance += invoice.balance;
    row.invoices += 1;
    row.oldestDays = Math.max(row.oldestDays, invoice.daysOutstanding);
    grouped.set(key, row);
  }

  return [...grouped.values()].sort((a, b) => b.oldestDays - a.oldestDays);
}
