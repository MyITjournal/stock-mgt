import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { StockAdjustmentReason, StockMovementType } from '@prisma/client';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { LocationService } from './location.service';
import { StockService, type StockWriter } from './stock.service';
import { OpeningStockDto } from './dto/opening-stock.dto';
import {
  OpeningStockProductView,
  OpeningStockResultView,
} from './dto/opening-stock.response';
import {
  costPriceAfterOpening,
  planOpeningStock,
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

  /** Every stocked product that has never had stock come in at this location. */
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
        },
        orderBy: { name: 'asc' },
      }),
      this.stockedAt(this.prisma, location),
    ]);

    return products
      .filter((product) => !stocked.has(product.id))
      .map((product) => ({
        id: product.id,
        name: product.name,
        size: product.size,
        sku: product.sku,
        category: product.category?.name ?? null,
        units: product.units,
        defaultUnitId: product.units[product.units.length - 1].id,
      }));
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

  /** Products that have ever had stock come in at this location. */
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
      distinct: ['productId'],
      select: { productId: true },
    });
    return new Set(rows.map((row) => row.productId));
  }
}
