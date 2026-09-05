import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { StockAdjustmentReason, StockMovementType } from '@prisma/client';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { LocationService } from './location.service';
import { StockService, StockWriter } from './stock.service';
import { CountLinesDto, CreateStocktakeDto } from './dto/stocktake.dto';

const STOCKTAKE_INCLUDE = {
  location: { select: { id: true, name: true } },
  startedBy: { select: { id: true, firstName: true, lastName: true } },
  postedBy: { select: { id: true, firstName: true, lastName: true } },
  lines: {
    include: {
      product: { select: { id: true, name: true, sku: true } },
      countedBy: { select: { id: true, firstName: true, lastName: true } },
    },
  },
} as const;

/**
 * Physical counts.
 *
 * **Counting is not adjusting**, and keeping them apart is the whole design. A
 * storekeeper walks the aisles and records what is on the shelf; a manager
 * looks at the variance and decides it is real. Until it is posted, a stocktake
 * changes nothing — it is a claim about the world, not a change to it.
 *
 * Posting writes ordinary `adjustment` movements through `StockService`, with
 * reason `count_correction`. Nothing here becomes a second source of truth for
 * stock: the ledger stays the only one (§5), and a count that has been posted
 * is readable afterwards as exactly the movements it caused.
 */
@Injectable()
export class StocktakeService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma,
    private readonly stock: StockService,
    private readonly locations: LocationService,
  ) {}

  async create(input: CreateStocktakeDto) {
    const locationId =
      input.locationId ?? (await this.locations.resolveDefaultId());
    await this.locations.assertExists(locationId);

    // Two open counts of the same shelves would post variances against each
    // other's corrections, and the second would be measuring the first.
    const open = await this.prisma.stocktake.findFirst({
      where: { locationId, status: 'open' },
      select: { id: true },
    });
    if (open) {
      throw new ConflictException(
        `A stocktake is already open at this location (${open.id}). Post or cancel it before starting another.`,
      );
    }

    return this.prisma.stocktake.create({
      data: {
        ...(input.id && { id: input.id }),
        organizationId: TenantContext.requireOrganizationId(),
        locationId,
        note: input.note ?? null,
        startedByUserId: TenantContext.get()?.userId ?? null,
      },
      include: STOCKTAKE_INCLUDE,
    });
  }

  findAll(filter: { status?: string; locationId?: string } = {}) {
    return this.prisma.stocktake.findMany({
      where: {
        ...(filter.status && { status: filter.status as 'open' }),
        ...(filter.locationId && { locationId: filter.locationId }),
      },
      orderBy: [{ startedAt: 'desc' }],
      include: STOCKTAKE_INCLUDE,
    });
  }

  /** One count, with the variance each line carries *right now*. */
  async findOne(id: string) {
    const stocktake = await this.prisma.stocktake.findFirst({
      where: { id },
      include: STOCKTAKE_INCLUDE,
    });
    if (!stocktake) throw new NotFoundException('Stocktake not found');

    const onHand = await this.onHandByProduct(
      stocktake.locationId,
      stocktake.lines.map((line) => line.productId),
    );

    // A posted count is history: its variance is what it *was*, so the stored
    // snapshot is the honest number. An open one is measured against live
    // stock, because that is what posting will actually compare.
    const live = stocktake.status === 'open';

    const lines = stocktake.lines.map((line) => {
      const expected = live
        ? (onHand.get(line.productId) ?? 0)
        : line.expectedQuantity;
      return {
        ...line,
        expectedQuantity: expected,
        variance: line.countedQuantity - expected,
      };
    });

    return {
      ...stocktake,
      lines,
      counted: lines.length,
      /** Lines where the shelf and the ledger disagree. */
      discrepancies: lines.filter((line) => line.variance !== 0).length,
      /** Net base units the ledger would move if this were posted. */
      netVariance: lines.reduce((sum, line) => sum + line.variance, 0),
    };
  }

  /**
   * Records what was counted. Accepts many lines at once, because a device that
   * has been counting a shelf offline syncs the whole sheet in one request.
   *
   * Counting the same product twice replaces the first line rather than adding
   * a second: a recount is a correction, not a second opinion.
   */
  async count(id: string, input: CountLinesDto) {
    const stocktake = await this.requireOpen(id);
    const organizationId = TenantContext.requireOrganizationId();
    const countedByUserId = TenantContext.get()?.userId ?? null;

    const productIds = input.lines.map((line) => line.productId);
    await this.assertProductsExist(productIds);
    const onHand = await this.onHandByProduct(stocktake.locationId, productIds);

    await this.prisma.$transaction(
      input.lines.map((line) =>
        this.prisma.stocktakeLine.upsert({
          where: {
            stocktakeId_productId: {
              stocktakeId: id,
              productId: line.productId,
            },
          },
          create: {
            organizationId,
            stocktakeId: id,
            productId: line.productId,
            countedQuantity: line.countedQuantity,
            // Snapshotted so the sheet still explains itself weeks later, when
            // stock has moved on. It is evidence, not the arithmetic.
            expectedQuantity: onHand.get(line.productId) ?? 0,
            note: line.note ?? null,
            countedByUserId,
          },
          update: {
            countedQuantity: line.countedQuantity,
            expectedQuantity: onHand.get(line.productId) ?? 0,
            note: line.note ?? null,
            countedByUserId,
            countedAt: new Date(),
          },
        }),
      ),
    );

    return this.findOne(id);
  }

  /** Removes a line counted by mistake. */
  async removeLine(id: string, productId: string) {
    await this.requireOpen(id);

    const line = await this.prisma.stocktakeLine.findFirst({
      where: { stocktakeId: id, productId },
    });
    if (!line) throw new NotFoundException('That product is not on this count');

    await this.prisma.stocktakeLine.delete({ where: { id: line.id } });
    return this.findOne(id);
  }

  /**
   * Turns the count into movements.
   *
   * The variance is recomputed here against live stock rather than trusting the
   * snapshot taken while counting: goods may have moved between the count and
   * the decision, and the ledger must record what was actually true when the
   * correction was made.
   *
   * A shortfall goes out FEFO — the same picking rule as a sale, so the lots
   * that disappear are the ones that would have sold next. A surplus has no
   * such natural lot, so it lands on the batch most recently received at that
   * location, keeping its cost basis current.
   */
  async post(id: string) {
    const stocktake = await this.requireOpen(id);

    if (stocktake.lines.length === 0) {
      throw new ConflictException(
        'Nothing has been counted, so there is nothing to post.',
      );
    }

    const posted = await this.prisma.$transaction(async (tx) => {
      const writer = tx as unknown as StockWriter;
      const onHand = await this.onHandByProduct(
        stocktake.locationId,
        stocktake.lines.map((line) => line.productId),
        tx,
      );

      let corrections = 0;

      for (const line of stocktake.lines) {
        const expected = onHand.get(line.productId) ?? 0;
        const variance = line.countedQuantity - expected;
        if (variance === 0) continue;

        const movement = {
          productId: line.productId,
          locationId: stocktake.locationId,
          quantity: Math.abs(variance),
          type: StockMovementType.adjustment,
          reason: StockAdjustmentReason.count_correction,
          note: line.note ?? undefined,
          referenceType: 'stocktake',
          referenceId: stocktake.id,
        };

        if (variance < 0) {
          await this.stock.recordOutbound(movement, writer);
        } else {
          await this.stock.recordInbound(
            {
              ...movement,
              batchId: await this.batchForSurplus(
                tx,
                line.productId,
                stocktake.locationId,
              ),
            },
            writer,
          );
        }

        corrections += 1;
      }

      await tx.stocktake.update({
        where: { id },
        data: {
          status: 'posted',
          postedAt: new Date(),
          postedByUserId: TenantContext.get()?.userId ?? null,
        },
      });

      return corrections;
    });

    return { ...(await this.findOne(id)), corrections: posted };
  }

  /** Abandons a count. The lines are kept; nothing reaches the ledger. */
  async cancel(id: string) {
    await this.requireOpen(id);

    await this.prisma.stocktake.update({
      where: { id },
      data: { status: 'cancelled', cancelledAt: new Date() },
    });

    return this.findOne(id);
  }

  /**
   * Which lot a surplus belongs to.
   *
   * Extra units found on a shelf have no lot of their own — nobody knows which
   * delivery they came from. Attributing them to the **most recently received
   * batch still holding stock there** keeps the cost basis current and, more
   * importantly, keeps §5's rule that every movement carries a batch.
   *
   * When the product has no stock at that location at all, the newest batch
   * anywhere is used, so a found item is still valued at what that product
   * actually costs. Only a product that has never been received needs a lot
   * invented, and that one is honestly worth nothing until somebody says
   * otherwise — §2 stores what was paid, and nothing was.
   */
  private async batchForSurplus(
    tx: Pick<TenantPrisma, 'stockBalance' | 'stockBatch'>,
    productId: string,
    locationId: string,
  ): Promise<string> {
    const here = await tx.stockBalance.findFirst({
      where: { productId, locationId, quantity: { gt: 0 } },
      orderBy: { batch: { receivedAt: 'desc' } },
      select: { batchId: true },
    });
    if (here) return here.batchId;

    const anywhere = await tx.stockBatch.findFirst({
      where: { productId },
      orderBy: { receivedAt: 'desc' },
      select: { id: true },
    });
    if (anywhere) return anywhere.id;

    const invented = await tx.stockBatch.create({
      data: {
        organizationId: TenantContext.requireOrganizationId(),
        productId,
        lotCode: 'FOUND',
        quantityReceived: 0,
        quantityPaidFor: 0,
        totalCost: 0,
      },
      select: { id: true },
    });
    return invented.id;
  }

  /** Base units on hand per product at one location. */
  private async onHandByProduct(
    locationId: string,
    productIds: string[],
    tx: Pick<TenantPrisma, 'stockBalance'> = this.prisma,
  ) {
    if (productIds.length === 0) return new Map<string, number>();

    const balances = await tx.stockBalance.groupBy({
      by: ['productId'],
      where: { locationId, productId: { in: productIds } },
      _sum: { quantity: true },
    });

    return new Map(
      balances.map((row) => [row.productId, row._sum.quantity ?? 0]),
    );
  }

  private async requireOpen(id: string) {
    const stocktake = await this.prisma.stocktake.findFirst({
      where: { id },
      include: { lines: true },
    });
    if (!stocktake) throw new NotFoundException('Stocktake not found');

    if (stocktake.status !== 'open') {
      throw new ConflictException(
        `This stocktake was already ${stocktake.status}. Start a new one to count again.`,
      );
    }
    return stocktake;
  }

  private async assertProductsExist(productIds: string[]) {
    const found = await this.prisma.product.findMany({
      where: { id: { in: productIds }, deletedAt: null },
      select: { id: true, trackStock: true },
    });

    const byId = new Map(found.map((product) => [product.id, product]));
    for (const productId of productIds) {
      const product = byId.get(productId);
      if (!product) {
        throw new NotFoundException(`Product ${productId} not found`);
      }
      // Counting a service would post an adjustment for something the ledger
      // deliberately ignores.
      if (!product.trackStock) {
        throw new ConflictException(
          `Product ${productId} is not stocked, so it cannot be counted.`,
        );
      }
    }
  }
}
