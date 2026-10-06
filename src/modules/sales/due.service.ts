import { Inject, Injectable } from '@nestjs/common';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { addDays, startOfDay } from '../reports/period';
import { LIVE_ALLOCATIONS, saleBalance } from '../payments/balance';
import { daysPastDue } from './due';
import { DueInvoicesView } from './dto/due.response';

/** How far ahead "due soon" looks, in days after today. */
const DUE_SOON_DAYS = 2;

/**
 * `GET /sales/due` — who to ask for money, and how late they are.
 *
 * Credit sales with money still owed whose due day is today or earlier, or
 * within the next two days, oldest first. What is owed is the one rule
 * (`saleBalance` over `LIVE_ALLOCATIONS`), so a voided payment does not hide
 * a debt and a refunded return does not leave one behind.
 *
 * **Open to every member of staff**, on purpose: the people at the counter are
 * the ones who see the customer walk in and can ask. Nothing here is a buying
 * price — names, phone numbers, invoice numbers and what is owed.
 */
@Injectable()
export class DueService {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma) {}

  async list(now: Date = new Date()): Promise<DueInvoicesView> {
    const organization = await this.prisma.organization.findFirst({
      where: { id: TenantContext.requireOrganizationId() },
      select: { timezone: true },
    });
    const timezone = organization?.timezone || 'Africa/Lagos';
    // The end of the last day "due soon" reaches.
    const horizon = addDays(
      timezone,
      startOfDay(timezone, now),
      DUE_SOON_DAYS + 1,
    );

    const sales = await this.prisma.sale.findMany({
      where: { dueDate: { not: null, lt: horizon }, customerId: { not: null } },
      orderBy: [{ dueDate: 'asc' }, { number: 'asc' }],
      select: {
        id: true,
        number: true,
        total: true,
        dueDate: true,
        customer: {
          select: { id: true, firstName: true, lastName: true, phone: true },
        },
        allocations: LIVE_ALLOCATIONS,
        returns: { select: { refundAmount: true } },
      },
    });

    const invoices = sales
      .map((sale) => ({ sale, ...saleBalance(sale) }))
      .filter(({ balance }) => balance > 0)
      .map(({ sale, balance }) => ({
        saleId: sale.id,
        number: sale.number,
        customer: {
          id: sale.customer!.id,
          name: [sale.customer!.firstName, sale.customer!.lastName]
            .filter(Boolean)
            .join(' '),
          phone: sale.customer!.phone,
        },
        balance,
        dueDate: sale.dueDate!,
        daysPastDue: daysPastDue(timezone, sale.dueDate!, now),
      }));

    return {
      invoices,
      overdue: invoices.filter((row) => row.daysPastDue > 0).length,
    };
  }
}
