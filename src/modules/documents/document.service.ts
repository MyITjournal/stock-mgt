import { Inject, Injectable } from '@nestjs/common';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { OrganizationService } from '../organization/organization.service';
import { SaleService } from '../sales/sale.service';
import { ReceivableService } from '../payments/receivable.service';
import { renderPdf } from './pdf';
import { Letterhead, PayableAccount, invoiceDefinition } from './invoice';
import { statementDefinition } from './statement';

/**
 * PDFs, built from the payloads the API already returns.
 *
 * Nothing here recomputes a figure. The invoice reads `SaleService.receipt`
 * and the statement reads `ReceivableService.statement`, so a printed document
 * and the screen it was printed from cannot disagree — which is the failure
 * §12 warns about whenever an arithmetic is implemented twice.
 */
@Injectable()
export class DocumentService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma,
    private readonly organizations: OrganizationService,
    private readonly sales: SaleService,
    private readonly receivables: ReceivableService,
  ) {}

  async invoicePdf(
    saleId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const [receipt, organization, accounts] = await Promise.all([
      this.sales.receipt(saleId),
      this.letterhead(),
      this.payableAccounts(),
    ]);

    const buffer = await renderPdf(
      invoiceDefinition({
        organization,
        accounts,
        invoice: {
          number: receipt.number,
          occurredAt: receipt.occurredAt,
          customer: receipt.customer,
          servedBy: receipt.servedBy,
          lines: receipt.lines,
          total: receipt.total,
          tax: receipt.tax,
          paid: receipt.paid,
          balance: receipt.balance,
          note: receipt.note,
        },
      }),
    );

    return { buffer, filename: `invoice-${receipt.number}.pdf` };
  }

  async statementPdf(
    customerId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const [statement, organization, accounts] = await Promise.all([
      this.receivables.statement(customerId),
      this.letterhead(),
      this.payableAccounts(),
    ]);

    const name = [statement.customer.firstName, statement.customer.lastName]
      .filter(Boolean)
      .join(' ');

    const buffer = await renderPdf(
      statementDefinition({
        organization,
        accounts,
        statement: {
          customer: { name, phone: statement.customer.phone },
          invoices: statement.invoices.map((invoice) => ({
            number: invoice.number,
            occurredAt: invoice.occurredAt,
            total: invoice.total,
            balance: invoice.balance,
            daysOutstanding: invoice.daysOutstanding,
          })),
          payments: statement.payments.map((payment) => ({
            occurredAt: payment.occurredAt,
            amount: payment.amount,
            method: payment.method,
            reference: payment.reference,
          })),
          credit: statement.credit,
          owed: statement.owed,
        },
      }),
    );

    return {
      buffer,
      filename: `statement-${slugify(name)}.pdf`,
    };
  }

  private async letterhead(): Promise<Letterhead> {
    const organization = await this.organizations.current();
    return {
      name: organization.name,
      address: organization.address,
      phone: organization.phone,
      email: organization.email,
      taxId: organization.taxId,
      rcNumber: organization.rcNumber,
      logoUrl: organization.logoUrl,
      currency: organization.currency,
      timezone: organization.timezone,
    };
  }

  /**
   * Every active account, default first — a business keeps several precisely so
   * a customer can pay into whichever bank they already use, so printing only
   * the default would defeat the point of having them.
   */
  private async payableAccounts(): Promise<PayableAccount[]> {
    const accounts = await this.prisma.bankAccount.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [
        { isDefault: 'desc' },
        { sortOrder: 'asc' },
        { bankName: 'asc' },
      ],
      select: { bankName: true, accountName: true, accountNumber: true },
    });
    return accounts;
  }
}

/** A filename a phone will not mangle when the document is shared. */
function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'customer'
  );
}
