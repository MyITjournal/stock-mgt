import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { StockAdjustmentReason, StockMovementType } from '@prisma/client';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { LocationService } from './location.service';
import { StockService, type StockWriter } from './stock.service';
import {
  CorrectLotCostDto,
  LotCostPreviewDto,
  OpeningStockDto,
} from './dto/opening-stock.dto';
import {
  LotCostCorrectionView,
  OpeningStockProductView,
  OpeningStockResultView,
} from './dto/opening-stock.response';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { MAX_MINOR_UNITS } from '../../common/money/is-money.validator';
import { optionLabel } from '../catalog/variants';
import {
  correctedOpeningTotal,
  costPriceAfterOpening,
  planOpeningStock,
  stockKey,
  type OpeningProduct,
} from './opening-stock';

/** The lot code every opening lot carries, so it reads as what it is. */
const OPENING_LOT = 'Opening';

/**
 * `GET` and `POST /stock/opening`: the sheet of products with no stock yet,
 * and saving it. The rules are in `opening-stock.ts`.
 */
@Injectable()
export class OpeningStockService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma,
    private readonly locations: LocationService,
    private readonly stock: StockService,
  ) {}

  /**
   * Every stocked product that has never had stock come in at this location —
   * one row per active option for a product with options, each asked about
   * on its own.
   */
  async list(locationId?: string): Promise<OpeningStockProductView[]> {
    const location = await this.location(locationId);
    const [products, stocked] = await Promise.all([
      this.prisma.product.findMany({
        where: { deletedAt: null, isActive: true, trackStock: true },
        select: {
          id: true,
          name: true,
          size: true,
          sku: true,
          category: { select: { name: true } },
          units: {
            select: { id: true, name: true, factor: true },
            orderBy: { factor: 'asc' },
          },
          variants: {
            where: { isActive: true },
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.stockedAt(this.prisma, location),
    ]);

    return products.flatMap((product) => {
      const row = {
        id: product.id,
        name: product.name,
        size: product.size,
        sku: product.sku,
        category: product.category?.name ?? null,
        units: product.units,
        defaultUnitId: product.units[product.units.length - 1].id,
      };
      const options =
        product.variants.length > 0
          ? product.variants
          : [{ id: null, name: null }];
      return options
        .filter((option) => !stocked.has(stockKey(product.id, option.id)))
        .map((option) => ({
          ...row,
          variantId: option.id,
          variantName: option.name,
        }));
    });
  }

  /**
   * Records every line, or none. Refused outright if any product has had
   * stock come in here since the sheet was opened — somebody else entered it,
   * and saving would count it twice.
   */
  async record(input: OpeningStockDto): Promise<OpeningStockResultView> {
    const location = await this.location(input.locationId);
    const productIds = [...new Set(input.lines.map((line) => line.productId))];
    const occurredAt = new Date();

    return this.prisma.$transaction(
      async (tx) => {
        const writer = tx as unknown as StockWriter;
        const products = await tx.product.findMany({
          where: {
            id: { in: productIds },
            deletedAt: null,
            trackStock: true,
          },
          select: {
            id: true,
            name: true,
            units: { select: { id: true, name: true, factor: true } },
            variants: { select: { id: true, name: true, isActive: true } },
          },
        });
        const byId = new Map<string, OpeningProduct>(
          products.map((product) => [product.id, product]),
        );
        // Read inside the transaction, so two people saving the same sheet
        // cannot both get through.
        const stocked = await this.stockedAt(writer, location, productIds);

        const plan = planOpeningStock(input.lines, byId, stocked);
        if (plan.alreadyStocked.length > 0) {
          const names = plan.alreadyStocked.slice(0, 5).join(', ');
          const more =
            plan.alreadyStocked.length > 5
              ? ` and ${plan.alreadyStocked.length - 5} more`
              : '';
          throw new ConflictException(
            `${names}${more} already ${plan.alreadyStocked.length === 1 ? 'has' : 'have'} stock here — probably entered while this sheet was open. Nothing was saved. Reload the sheet; a count corrects a product that already has stock.`,
          );
        }
        if (plan.problems.length > 0) {
          throw new BadRequestException(
            `${plan.problems.join(' ')} Nothing was saved.`,
          );
        }

        await this.stock.recordNewLots(
          plan.lines.map((line) => ({
            productId: line.productId,
            variantId: line.variantId,
            locationId: location,
            quantity: line.quantity,
            type: StockMovementType.adjustment,
            reason: StockAdjustmentReason.opening_balance,
            occurredAt,
            lotCode: OPENING_LOT,
            expiryDate: line.expiryDate,
            totalCost: line.totalCost,
            // Bought before Reho: nothing was paid for through it, so no bill,
            // vendor target or purchases report counts it.
            quantityPaidFor: 0,
          })),
          writer,
        );

        // The cost-price display, as a delivery writes it. One update per
        // product; there is no statement that sets a different value on
        // each row.
        for (const [id, costPrice] of costPriceAfterOpening(plan.lines)) {
          await tx.product.update({ where: { id }, data: { costPrice } });
        }

        return {
          products: new Set(plan.lines.map((line) => line.productId)).size,
          lines: plan.lines.length,
          totalValue: plan.lines.reduce((sum, line) => sum + line.totalCost, 0),
        };
      },
      { timeout: 60_000 },
    );
  }

  private async location(locationId?: string): Promise<string> {
    const id = locationId ?? (await this.locations.resolveDefaultId());
    await this.locations.assertExists(id);
    return id;
  }

  /**
   * Products — and options, keyed by `stockKey` — that have ever had stock
   * come in at this location. An option counts once anything came into it,
   * including the stock moved into it when the product's options were added.
   */
  private async stockedAt(
    db: Pick<StockWriter, 'stockMovement'>,
    locationId: string,
    productIds?: string[],
  ): Promise<Set<string>> {
    const rows = await db.stockMovement.findMany({
      where: {
        locationId,
        quantity: { gt: 0 },
        ...(productIds && { productId: { in: productIds } }),
      },
      distinct: ['productId', 'variantId'],
      select: { productId: true, variantId: true },
    });
    return new Set(rows.map((row) => stockKey(row.productId, row.variantId)));
  }

  /**
   * What an opening lot would be worth at a corrected cost — nothing written.
   * The screen shows this before anyone saves, so the browser computes no
   * money (§17).
   */
  async previewCostCorrection(
    batchId: string,
    input: LotCostPreviewDto,
  ): Promise<LotCostCorrectionView> {
    const planned = await this.planCostCorrection(this.prisma, batchId, input);
    return { ...planned.view, saved: false };
  }

  /**
   * Puts an opening lot's value right (2026-10-07). Only the value: the lot
   * keeps its quantity and its movements, sales already made keep the cost
   * they recorded, and a `LotCostCorrection` says what it was before, who
   * changed it and why. Stock value, margins and later sales read the new
   * total at once.
   */
  async correctCost(
    batchId: string,
    input: CorrectLotCostDto,
  ): Promise<LotCostCorrectionView> {
    return this.prisma.$transaction(async (tx) => {
      const db = tx as unknown as TenantPrisma;
      const planned = await this.planCostCorrection(db, batchId, input);
      await db.stockBatch.update({
        where: { id: batchId },
        data: { totalCost: planned.view.totalCostAfter },
      });
      await db.lotCostCorrection.create({
        data: {
          organizationId: TenantContext.requireOrganizationId(),
          batchId,
          totalCostBefore: planned.view.totalCostBefore,
          totalCostAfter: planned.view.totalCostAfter,
          reason: input.reason.trim(),
          recordedByUserId: TenantContext.get()?.userId ?? null,
        },
      });
      // The cost display on the product, when no delivery has set it since:
      // it was written from this lot, so it was wrong in the same way.
      if (!planned.deliveredSince) {
        await db.product.update({
          where: { id: planned.productId },
          data: {
            costPrice: Math.round(
              planned.view.totalCostAfter / planned.view.quantity,
            ),
          },
        });
      }
      return { ...planned.view, saved: true };
    });
  }

  /** Loads the lot, checks it is opening stock, and works out the new total. */
  private async planCostCorrection(
    db: TenantPrisma,
    batchId: string,
    input: LotCostPreviewDto,
  ) {
    const lot = await db.stockBatch.findFirst({
      where: { id: batchId },
      select: {
        id: true,
        productId: true,
        receivedAt: true,
        quantityReceived: true,
        totalCost: true,
        receiptLine: { select: { id: true } },
        movements: {
          where: { reason: StockAdjustmentReason.opening_balance },
          // An opening lot is one option's (or none): its name goes on the
          // dialog, so "Indomie — Chicken" is what is being corrected.
          select: { id: true, variant: { select: { name: true } } },
          take: 1,
        },
        product: {
          select: {
            name: true,
            units: { select: { id: true, name: true, factor: true } },
          },
        },
      },
    });
    if (!lot) throw new NotFoundException('That lot was not found.');
    if (lot.receiptLine) {
      throw new ConflictException(
        'This lot came in on a delivery. Correct the delivery instead — open it under Deliveries.',
      );
    }
    if (lot.movements.length === 0) {
      throw new ConflictException(
        'Only opening stock can have its cost corrected here.',
      );
    }
    const unit = lot.product.units.find((row) => row.id === input.unitId);
    if (!unit) {
      throw new BadRequestException(
        `That unit is not one of ${lot.product.name}'s units.`,
      );
    }
    const base = lot.product.units.find((row) => row.factor === 1);
    const totalCostAfter = correctedOpeningTotal({
      quantityReceived: lot.quantityReceived,
      unitFactor: unit.factor,
      unitCost: input.unitCost,
    });
    if (totalCostAfter > MAX_MINOR_UNITS) {
      throw new BadRequestException('That cost is too large to record.');
    }
    const deliveredSince = await db.stockBatch.findFirst({
      where: {
        productId: lot.productId,
        receiptLine: { isNot: null },
        receivedAt: { gte: lot.receivedAt },
      },
      select: { id: true },
    });

    return {
      productId: lot.productId,
      deliveredSince: Boolean(deliveredSince),
      view: {
        batchId: lot.id,
        productName: optionLabel(
          lot.product.name,
          lot.movements[0].variant?.name,
        ),
        quantity: lot.quantityReceived,
        baseUnitName: base?.name ?? 'unit',
        totalCostBefore: lot.totalCost,
        totalCostAfter,
      },
    };
  }
}
