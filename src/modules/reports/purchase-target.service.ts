import {
  BadRequestException,
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
import { ReceiptLine, TargetRow, rollUpTargets } from './purchase-target';
import {
  CreatePurchaseTargetDto,
  PurchaseTargetQueryDto,
  UpdatePurchaseTargetDto,
} from './dto/purchase-target.dto';

const TARGET_INCLUDE = {
  supplier: true,
  category: true,
  product: true,
  displayUnit: true,
} as const;

/**
 * The vendor's monthly offtake quota, and how much of it has actually landed.
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

  async create(input: CreatePurchaseTargetDto) {
    const scope = await this.resolveScope(input);
    const periodStart = await this.monthStart(input.period);
    const { targetQuantity, displayUnitId, unitFactor } =
      await this.resolveQuantity(input, scope.productId);

    await this.assertSupplierExists(input.supplierId);

    try {
      return await this.prisma.purchaseTarget.create({
        data: {
          ...(input.id && { id: input.id }),
          organizationId: TenantContext.requireOrganizationId(),
          supplierId: input.supplierId,
          categoryId: scope.categoryId,
          productId: scope.productId,
          periodStart,
          targetQuantity,
          displayUnitId,
          unitFactor,
          targetValue: input.targetValue ?? null,
          note: input.note ?? null,
        },
        include: TARGET_INCLUDE,
      });
    } catch (error) {
      throw translateDuplicate(error);
    }
  }

  findAll(query: PurchaseTargetQueryDto = {}) {
    return this.prisma.purchaseTarget.findMany({
      where: {
        deletedAt: null,
        ...(query.supplierId && { supplierId: query.supplierId }),
      },
      include: TARGET_INCLUDE,
      orderBy: [{ periodStart: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async findOne(id: string) {
    const target = await this.prisma.purchaseTarget.findFirst({
      where: { id, deletedAt: null },
      include: TARGET_INCLUDE,
    });
    if (!target) throw new NotFoundException('Purchase target not found');
    return target;
  }

  async update(id: string, input: UpdatePurchaseTargetDto) {
    const existing = await this.findOne(id);

    // The scope is what the target *is*; changing a lotions target into a
    // roll-on one silently rewrites what last month's number meant. Delete it
    // and set the one that was actually agreed.
    if (input.categoryId !== undefined || input.productId !== undefined) {
      throw new BadRequestException(
        'A target cannot change what it is set against. Delete it and create the one you mean.',
      );
    }

    const periodStart = input.period
      ? await this.monthStart(input.period)
      : existing.periodStart;

    const quantity =
      input.targetQuantity !== undefined || input.unitId !== undefined
        ? await this.resolveQuantity(
            {
              targetQuantity: input.targetQuantity ?? existing.targetQuantity,
              unitId: input.unitId,
            },
            existing.productId,
          )
        : null;

    try {
      return await this.prisma.purchaseTarget.update({
        where: { id },
        data: {
          ...(input.supplierId !== undefined && {
            supplierId: input.supplierId,
          }),
          periodStart,
          ...(quantity && {
            targetQuantity: quantity.targetQuantity,
            displayUnitId: quantity.displayUnitId,
            unitFactor: quantity.unitFactor,
          }),
          ...(input.targetValue !== undefined && {
            targetValue: input.targetValue,
          }),
          ...(input.note !== undefined && { note: input.note }),
        },
        include: TARGET_INCLUDE,
      });
    } catch (error) {
      throw translateDuplicate(error);
    }
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
   * Target, achieved and remaining for one month.
   *
   * Progress is counted from goods **received** rather than orders placed: an
   * order the vendor has not delivered is exactly what still needs chasing, so
   * it belongs in "remaining".
   */
  async report(query: PurchaseTargetQueryDto = {}) {
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

    if (targets.length === 0) {
      return { periodStart, periodEnd, targets: [] };
    }

    const suppliers = [...new Set(targets.map((row) => row.supplierId))];

    const lines = await this.prisma.goodsReceiptLine.findMany({
      where: {
        receipt: {
          supplierId: { in: suppliers },
          receivedAt: { gte: periodStart, lt: periodEnd },
        },
      },
      select: {
        productId: true,
        quantityPaidFor: true,
        totalCost: true,
        product: { select: { categoryId: true } },
        receipt: { select: { supplierId: true } },
      },
    });

    // Rolled up per vendor: two vendors quotaing the same category must not
    // see each other's deliveries.
    const progressById = new Map<string, ReturnType<typeof rollUpTargets>[0]>();
    for (const supplierId of suppliers) {
      const rows: TargetRow[] = targets
        .filter((target) => target.supplierId === supplierId)
        .map((target) => ({
          id: target.id,
          categoryId: target.categoryId,
          productId: target.productId,
          targetQuantity: target.targetQuantity,
          targetValue: target.targetValue,
        }));

      const received: ReceiptLine[] = lines
        .filter((line) => line.receipt.supplierId === supplierId)
        .map((line) => ({
          productId: line.productId,
          categoryId: line.product.categoryId,
          quantityPaidFor: line.quantityPaidFor,
          totalCost: line.totalCost,
        }));

      for (const progress of rollUpTargets(rows, received)) {
        progressById.set(progress.targetId, progress);
      }
    }

    return {
      periodStart,
      periodEnd,
      targets: targets.map((target) => ({
        ...target,
        progress: progressById.get(target.id)!,
      })),
    };
  }

  /** Exactly one of category or product, matching the CHECK on the table. */
  private async resolveScope(input: CreatePurchaseTargetDto) {
    const named = [input.categoryId, input.productId].filter(Boolean);
    if (named.length !== 1) {
      throw new BadRequestException(
        'A target is set against exactly one of categoryId or productId.',
      );
    }

    if (input.categoryId) {
      const category = await this.prisma.category.findFirst({
        where: { id: input.categoryId, deletedAt: null },
      });
      if (!category) throw new NotFoundException('Category not found');
    } else {
      const product = await this.prisma.product.findFirst({
        where: { id: input.productId, deletedAt: null },
      });
      if (!product) throw new NotFoundException('Product not found');
    }

    return {
      categoryId: input.categoryId ?? null,
      productId: input.productId ?? null,
    };
  }

  /**
   * The target in base units, plus what it was quoted in.
   *
   * Converting on write is the same rule receiving follows: the factor is
   * captured now, so redefining a carton next year cannot quietly restate a
   * quota that was agreed in cartons of twenty-four.
   */
  private async resolveQuantity(
    input: { targetQuantity: number; unitId?: string },
    productId: string | null,
  ) {
    if (!input.unitId) {
      return {
        targetQuantity: input.targetQuantity,
        displayUnitId: null,
        unitFactor: 1,
      };
    }

    const unit = await this.prisma.productUnit.findFirst({
      where: { id: input.unitId },
    });
    if (!unit) throw new NotFoundException('Product unit not found');

    // A category target quoted in one product's cartons would be measuring
    // cases of something it does not cover.
    if (productId && unit.productId !== productId) {
      throw new BadRequestException(
        'That unit does not belong to the product this target is set against.',
      );
    }

    return {
      targetQuantity: input.targetQuantity * unit.factor,
      displayUnitId: unit.id,
      unitFactor: unit.factor,
    };
  }

  /** Snaps any instant to the first of its month, in the org's timezone. */
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
}

/**
 * The partial unique indexes in the migration, in words.
 *
 * Two targets for the same vendor, month and thing would each report the full
 * progress, so the vendor's sheet and ours would disagree by exactly a double
 * count — which reads as being comfortably ahead of a quota nobody has met.
 */
function translateDuplicate(error: unknown): Error {
  if (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  ) {
    return new ConflictException(
      'This vendor already has a target for that category or product in this month. Edit it rather than adding a second.',
    );
  }
  return error as Error;
}
