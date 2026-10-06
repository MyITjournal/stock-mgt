import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { ReportService } from './report.service';
import { addMonths, startOfMonth } from './period';
import {
  ReceiptLine,
  TargetRow,
  cartonFactor,
  moneyProgress,
  rollUpTargets,
} from './purchase-target';
import {
  CreateMoneyTargetDto,
  UpdateMoneyTargetDto,
} from './dto/money-target.dto';
import {
  CreatePurchaseTargetDto,
  PurchaseTargetQueryDto,
  UpdatePurchaseTargetDto,
} from './dto/purchase-target.dto';
import {
  MoneyTargetWithProgress,
  PurchaseTargetReportView,
  PurchaseTargetView,
} from './dto/purchase-target.response';

/**
 * What a target carries about the things it points at — selected, never the
 * whole row (§9: select, never exclude).
 */
const TARGET_INCLUDE = {
  supplier: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
} as const;

/**
 * The vendor's monthly quota for a category, in cartons, and how much of it
 * has actually landed.
 *
 * The only writes in an otherwise read-only module. They live here rather than
 * in a module of their own because a target is meaningless apart from the
 * report that measures it, and §15 kept the two together deliberately.
 */
@Injectable()
export class PurchaseTargetService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma,
    private readonly reports: ReportService,
  ) {}

  async create(input: CreatePurchaseTargetDto): Promise<PurchaseTargetView> {
    const periodStart = await this.monthStart(input.period);
    await this.assertSupplierExists(input.supplierId);
    await this.assertCategoryExists(input.categoryId);

    try {
      return await this.prisma.purchaseTarget.create({
        data: {
          ...(input.id && { id: input.id }),
          organizationId: TenantContext.requireOrganizationId(),
          supplierId: input.supplierId,
          categoryId: input.categoryId,
          periodStart,
          targetCartons: input.targetCartons,
          note: input.note?.trim() || null,
        },
        include: TARGET_INCLUDE,
      });
    } catch (error) {
      throw translateDuplicate(error);
    }
  }

  findAll(query: PurchaseTargetQueryDto = {}): Promise<PurchaseTargetView[]> {
    return this.prisma.purchaseTarget.findMany({
      where: {
        deletedAt: null,
        ...(query.supplierId && { supplierId: query.supplierId }),
      },
      include: TARGET_INCLUDE,
      orderBy: [{ periodStart: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async findOne(id: string): Promise<PurchaseTargetView> {
    const target = await this.prisma.purchaseTarget.findFirst({
      where: { id, deletedAt: null },
      include: TARGET_INCLUDE,
    });
    if (!target) throw new NotFoundException('Purchase target not found');
    return target;
  }

  /**
   * The number of cartons and the note. The vendor, category and month are
   * what the target is, and the DTO does not carry them.
   */
  async update(
    id: string,
    input: UpdatePurchaseTargetDto,
  ): Promise<PurchaseTargetView> {
    await this.findOne(id);
    return this.prisma.purchaseTarget.update({
      where: { id },
      data: {
        ...(input.targetCartons !== undefined && {
          targetCartons: input.targetCartons,
        }),
        ...(input.note !== undefined && { note: input.note.trim() || null }),
      },
      include: TARGET_INCLUDE,
    });
  }

  /** Soft, so a month already reported on keeps explaining itself. */
  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.purchaseTarget.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Target, achieved and remaining for one month, in cartons.
   *
   * Progress is counted from goods **received** rather than orders placed: an
   * order the vendor has not delivered is exactly what still needs chasing, so
   * it belongs in "remaining".
   */
  async report(
    query: PurchaseTargetQueryDto = {},
  ): Promise<PurchaseTargetReportView> {
    const periodStart = await this.monthStart(query.period);
    const timezone = await this.reports.timezone();
    const periodEnd = addMonths(timezone, periodStart, 1);

    const targets = await this.prisma.purchaseTarget.findMany({
      where: {
        deletedAt: null,
        periodStart,
        ...(query.supplierId && { supplierId: query.supplierId }),
      },
      include: TARGET_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });

    const moneyTargets = await this.moneyTargets(
      periodStart,
      periodEnd,
      query.supplierId,
    );

    if (targets.length === 0) {
      return { periodStart, periodEnd, targets: [], moneyTargets };
    }

    const suppliers = [...new Set(targets.map((row) => row.supplierId))];
    const categories = [...new Set(targets.map((row) => row.categoryId))];

    const [lines, withoutCarton] = await Promise.all([
      this.prisma.goodsReceiptLine.findMany({
        where: {
          receipt: {
            supplierId: { in: suppliers },
            receivedAt: { gte: periodStart, lt: periodEnd },
          },
          product: { categoryId: { in: categories } },
        },
        select: {
          productId: true,
          quantityPaidFor: true,
          product: {
            select: { categoryId: true, units: { select: { factor: true } } },
          },
          receipt: { select: { supplierId: true } },
        },
      }),
      this.productsWithoutCarton(categories),
    ]);

    // Rolled up per vendor: two vendors quotaing the same category must not
    // see each other's deliveries.
    const progressById = new Map<string, ReturnType<typeof rollUpTargets>[0]>();
    for (const supplierId of suppliers) {
      const rows: TargetRow[] = targets
        .filter((target) => target.supplierId === supplierId)
        .map((target) => ({
          id: target.id,
          categoryId: target.categoryId,
          targetCartons: target.targetCartons,
        }));

      const received: ReceiptLine[] = lines
        .filter((line) => line.receipt.supplierId === supplierId)
        .map((line) => ({
          productId: line.productId,
          categoryId: line.product.categoryId,
          quantityPaidFor: line.quantityPaidFor,
          cartonFactor: cartonFactor(line.product.units),
        }));

      for (const progress of rollUpTargets(rows, received)) {
        progressById.set(progress.targetId, progress);
      }
    }

    return {
      periodStart,
      periodEnd,
      moneyTargets,
      targets: targets.map((target) => ({
        ...target,
        progress: {
          ...progressById.get(target.id)!,
          productsWithoutCarton: withoutCarton.get(target.categoryId) ?? [],
        },
      })),
    };
  }

  /**
   * Stocked products in each category with nothing bigger than their base
   * unit — so no carton to count their deliveries in. Named on the target so a
   * low number explains itself; the fix is to give the product its carton.
   */
  private async productsWithoutCarton(categoryIds: string[]) {
    const products = await this.prisma.product.findMany({
      where: {
        categoryId: { in: categoryIds },
        deletedAt: null,
        trackStock: true,
      },
      select: {
        id: true,
        name: true,
        categoryId: true,
        units: { select: { factor: true } },
      },
      orderBy: { name: 'asc' },
    });

    const byCategory = new Map<string, { id: string; name: string }[]>();
    for (const product of products) {
      if (cartonFactor(product.units) !== null || !product.categoryId) continue;
      const list = byCategory.get(product.categoryId) ?? [];
      list.push({ id: product.id, name: product.name });
      byCategory.set(product.categoryId, list);
    }
    return byCategory;
  }

  /** Snaps any instant to the first of its month, in the org's timezone. */
  // -- Money targets -------------------------------------------------------

  async createMoney(input: CreateMoneyTargetDto): Promise<{ id: string }> {
    await this.assertSupplierExists(input.supplierId);
    const periodStart = await this.monthStart(input.period);
    try {
      const row = await this.prisma.vendorMoneyTarget.create({
        data: {
          ...(input.id && { id: input.id }),
          organizationId: TenantContext.requireOrganizationId(),
          supplierId: input.supplierId,
          periodStart,
          amount: input.amount,
          addsVat: input.addsVat ?? true,
          note: input.note?.trim() || null,
        },
        select: { id: true },
      });
      return row;
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: unknown }).code === 'P2002'
      ) {
        throw new ConflictException(
          'This vendor already has a money target for that month. Change that one instead.',
        );
      }
      throw error;
    }
  }

  async updateMoney(
    id: string,
    input: UpdateMoneyTargetDto,
  ): Promise<{ id: string }> {
    await this.findMoneyOrFail(id);
    return this.prisma.vendorMoneyTarget.update({
      where: { id },
      data: {
        ...(input.amount !== undefined && { amount: input.amount }),
        ...(input.addsVat !== undefined && { addsVat: input.addsVat }),
        ...(input.note !== undefined && { note: input.note.trim() || null }),
      },
      select: { id: true },
    });
  }

  async removeMoney(id: string): Promise<void> {
    await this.findMoneyOrFail(id);
    await this.prisma.vendorMoneyTarget.delete({ where: { id } });
  }

  /**
   * Each vendor's money target for the month against the invoice value of
   * what arrived from them. Summed from `GoodsReceiptLine.totalCost` — the
   * exact invoice figures — so free goods add nothing; VAT comes off the
   * month's total once, in `moneyProgress`.
   */
  private async moneyTargets(
    periodStart: Date,
    periodEnd: Date,
    supplierId?: string,
  ): Promise<MoneyTargetWithProgress[]> {
    const targets = await this.prisma.vendorMoneyTarget.findMany({
      where: { periodStart, ...(supplierId && { supplierId }) },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        periodStart: true,
        amount: true,
        addsVat: true,
        note: true,
        supplier: { select: { id: true, name: true } },
      },
    });
    if (targets.length === 0) return [];

    const lines = await this.prisma.goodsReceiptLine.findMany({
      where: {
        receipt: {
          supplierId: { in: targets.map((row) => row.supplier.id) },
          receivedAt: { gte: periodStart, lt: periodEnd },
        },
      },
      select: { totalCost: true, receipt: { select: { supplierId: true } } },
    });
    const invoiced = new Map<string, number>();
    for (const line of lines) {
      const id = line.receipt.supplierId;
      invoiced.set(id, (invoiced.get(id) ?? 0) + line.totalCost);
    }

    return targets.map((target) => ({
      ...target,
      ...moneyProgress(target, invoiced.get(target.supplier.id) ?? 0),
    }));
  }

  private async findMoneyOrFail(id: string) {
    const row = await this.prisma.vendorMoneyTarget.findFirst({
      where: { id },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Money target not found');
    return row;
  }

  private async monthStart(period?: string): Promise<Date> {
    const timezone = await this.reports.timezone();
    return startOfMonth(timezone, period ? new Date(period) : new Date());
  }

  private async assertSupplierExists(supplierId: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, deletedAt: null },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');
  }

  private async assertCategoryExists(categoryId: string) {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, deletedAt: null },
    });
    if (!category) throw new NotFoundException('Category not found');
  }
}

/**
 * The partial unique index in the migration, in words.
 *
 * Two targets for the same vendor, category and month would each report the
 * full progress, so the vendor's sheet and ours would disagree by exactly a
 * double count — which reads as being comfortably ahead of a quota nobody met.
 */
function translateDuplicate(error: unknown): Error {
  if (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  ) {
    return new ConflictException(
      'This vendor already has a target for that category in this month. Edit it rather than adding a second.',
    );
  }
  return error as Error;
}
