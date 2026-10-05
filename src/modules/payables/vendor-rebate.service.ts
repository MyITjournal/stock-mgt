import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { startOfMonth } from '../reports/period';
import { SupplierBillService } from './supplier-bill.service';
import {
  CreateVendorRebateDto,
  CreditVendorRebateDto,
  UpdateVendorRebateDto,
} from './dto/vendor-rebate.dto';
import { VendorRebateView } from './dto/vendor-rebate.response';

const REBATE_SELECT = {
  id: true,
  periodStart: true,
  expectedAmount: true,
  note: true,
  creditedAmount: true,
  creditedAt: true,
  supplier: { select: { id: true, name: true } },
  bill: { select: { id: true, invoiceNumber: true, issuedAt: true } },
} as const;

type RebateRow = Prisma.VendorRebateGetPayload<{
  select: typeof REBATE_SELECT;
}>;

/**
 * Vendor rebates: expected for a month, then credited off a later bill.
 *
 * ## What it is, and what it is not
 *
 * A vendor pays a rebate **only as credit off a later bill** (§16). So it is
 * not a payment — no money moved, and Money out never shows it — and it is not
 * an expense. It is a reduction in what one bill owes, which is why it is a
 * term in `billBalance` rather than a row anywhere else, and a line of its own
 * in profit, counted in the month the credit landed. It never changes stock
 * cost: the goods keep the cost their invoice gave them.
 *
 * ## Two steps, because the owner knows two things at two times
 *
 * When a month's target is met, the owner knows roughly what is coming and
 * records it as **expected** — a tentative figure, because the vendor works
 * out the real one later. When it lands on a bill, they **credit** it with the
 * real figure. Whether the target was met is their judgement, not a rule here:
 * schemes vary by vendor, and encoding them is accounting software.
 *
 * ## A credit never overpays a bill
 *
 * The same rule as a payment: a credit bigger than what the bill still owes is
 * refused, and goes on a bigger bill instead. Splitting one credit across
 * bills would need an allocation table, which the vendor side deliberately
 * does not have.
 */
@Injectable()
export class VendorRebateService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma,
    private readonly bills: SupplierBillService,
  ) {}

  async findAll(
    filter: {
      supplierId?: string;
      period?: string;
      expectedOnly?: boolean;
    } = {},
  ): Promise<VendorRebateView[]> {
    const periodStart = filter.period
      ? await this.monthStart(filter.period)
      : undefined;
    const rows = await this.prisma.vendorRebate.findMany({
      where: {
        ...(filter.supplierId && { supplierId: filter.supplierId }),
        ...(periodStart && { periodStart }),
        ...(filter.expectedOnly && { billId: null }),
      },
      orderBy: [{ periodStart: 'desc' }, { createdAt: 'asc' }],
      select: REBATE_SELECT,
    });
    return rows.map(view);
  }

  async create(input: CreateVendorRebateDto): Promise<VendorRebateView> {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: input.supplierId, deletedAt: null },
      select: { id: true },
    });
    if (!supplier) throw new NotFoundException('Vendor not found');

    const periodStart = await this.monthStart(input.period);
    try {
      const row = await this.prisma.vendorRebate.create({
        data: {
          ...(input.id && { id: input.id }),
          organizationId: TenantContext.requireOrganizationId(),
          supplierId: input.supplierId,
          periodStart,
          expectedAmount: input.expectedAmount,
          note: input.note?.trim() || null,
          recordedByUserId: TenantContext.get()?.userId ?? null,
        },
        select: REBATE_SELECT,
      });
      return view(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'A rebate is already recorded for this vendor and month. Change that one instead.',
        );
      }
      throw error;
    }
  }

  async update(
    id: string,
    input: UpdateVendorRebateDto,
  ): Promise<VendorRebateView> {
    const rebate = await this.findOneOrFail(id);
    if (input.expectedAmount !== undefined && rebate.creditedAt) {
      throw new ConflictException(
        'This rebate is already credited, so what was expected no longer matters. Remove the credit first to change it.',
      );
    }
    const row = await this.prisma.vendorRebate.update({
      where: { id },
      data: {
        ...(input.expectedAmount !== undefined && {
          expectedAmount: input.expectedAmount,
        }),
        ...(input.note !== undefined && { note: input.note.trim() || null }),
      },
      select: REBATE_SELECT,
    });
    return view(row);
  }

  async remove(id: string): Promise<void> {
    const rebate = await this.findOneOrFail(id);
    if (rebate.creditedAt) {
      throw new ConflictException(
        'This rebate is credited on a bill. Remove the credit first, or the bill would go back to owing without anyone saying why.',
      );
    }
    await this.prisma.vendorRebate.delete({ where: { id } });
  }

  /**
   * The credit landing on a bill. The bill's balance drops by `amount`, and
   * profit counts it in the month of the bill's own date.
   */
  async credit(
    id: string,
    input: CreditVendorRebateDto,
  ): Promise<VendorRebateView> {
    return this.prisma.$transaction(async (tx) => {
      const rebate = await tx.vendorRebate.findFirst({
        where: { id },
        select: { id: true, supplierId: true, creditedAt: true },
      });
      if (!rebate) throw new NotFoundException('Rebate not found');
      if (rebate.creditedAt) {
        throw new ConflictException('This rebate is already credited.');
      }

      // Read inside the transaction, through the one balance rule, so the
      // credit is checked against what the bill owes right now.
      const bill = await this.bills.balanceOf(input.billId, tx);
      if (bill.supplierId !== rebate.supplierId) {
        throw new BadRequestException(
          'That bill is from another vendor. A rebate comes off its own vendor’s bill.',
        );
      }
      if (input.amount > bill.balance) {
        throw new ConflictException(
          `This bill still owes ${naira(bill.balance)}, and a credit of ${naira(input.amount)} is more than that. Apply it to a bigger bill from this vendor.`,
        );
      }

      const issued = await tx.supplierBill.findFirst({
        where: { id: bill.id },
        select: { issuedAt: true },
      });

      const row = await tx.vendorRebate.update({
        where: { id },
        data: {
          billId: bill.id,
          creditedAmount: input.amount,
          creditedAt: issued!.issuedAt,
        },
        select: REBATE_SELECT,
      });
      return view(row);
    });
  }

  /** A credit put on the wrong bill: the bill owes again, the rebate is expected again. */
  async uncredit(id: string): Promise<VendorRebateView> {
    const rebate = await this.findOneOrFail(id);
    if (!rebate.creditedAt) {
      throw new ConflictException('This rebate has not been credited yet.');
    }
    const row = await this.prisma.vendorRebate.update({
      where: { id },
      data: { billId: null, creditedAmount: null, creditedAt: null },
      select: REBATE_SELECT,
    });
    return view(row);
  }

  private async findOneOrFail(id: string) {
    const rebate = await this.prisma.vendorRebate.findFirst({
      where: { id },
      select: { id: true, creditedAt: true },
    });
    if (!rebate) throw new NotFoundException('Rebate not found');
    return rebate;
  }

  /** Snapped as a purchase target is: the first of the month, in the shop's zone. */
  private async monthStart(period: string): Promise<Date> {
    const organization = await this.prisma.organization.findFirst({
      where: { id: TenantContext.requireOrganizationId() },
      select: { timezone: true },
    });
    return startOfMonth(
      organization?.timezone || 'Africa/Lagos',
      new Date(period),
    );
  }
}

function view(row: RebateRow): VendorRebateView {
  return {
    ...row,
    status: row.creditedAt ? 'credited' : 'expected',
  };
}

/** For a message a person reads: ₦12,500.00. */
function naira(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
