import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  StockAdjustmentReason,
  StockMovementType,
  type StocktakeLine,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { checkVariant } from '../catalog/variants';
import { LocationService } from './location.service';
import { StockService, StockWriter } from './stock.service';
import { CountLinesDto, CreateStocktakeDto } from './dto/stocktake.dto';
import {
  PostedStocktakeView,
  StocktakeSummary,
  StocktakeView,
} from './dto/stocktake.response';

const STOCKTAKE_INCLUDE = {
  location: { select: { id: true, name: true } },
  startedBy: { select: { id: true, firstName: true, lastName: true } },
  postedBy: { select: { id: true, firstName: true, lastName: true } },
  lines: {
    include: {
      product: { select: { id: true, name: true, sku: true } },
      variant: { select: { id: true, name: true } },
      countedBy: { select: { id: true, firstName: true, lastName: true } },
    },
  },
} as const;

/**
 * One count line per product and option — the key `onHand` is read by. Each
 * option is counted as an item of its own (owner, 2026-10-08).
 */
const lineKey = (productId: string, variantId?: string | null) =>
  `${productId}:${variantId ?? '-'}`;

/** A count line that disagrees with the ledger, and by how much. */
interface Variance {
  line: StocktakeLine;
  /** Counted minus on hand: negative short, positive over. */
  variance: number;
}

/**
 * Physical counts.
 *
 * **Counting is not adjusting**, and keeping them apart is the whole design. A
 * storekeeper walks the aisles and records what is on the shelf; a manager
 * looks at the variance and decides it is real. Until it is posted, a stocktake
 * changes nothing — it is a claim about the world, not a change to it.
 *
 * Posting writes ordinary movements through `StockService`, with reason
 * `count_correction`: adjustments, and moves between one product's options
 * where one is short and another over (`postProduct`). Nothing here becomes a second source of truth for
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

  async create(input: CreateStocktakeDto): Promise<StocktakeSummary> {
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

  findAll(
    filter: { status?: string; locationId?: string } = {},
  ): Promise<StocktakeSummary[]> {
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
  async findOne(id: string): Promise<StocktakeView> {
    const stocktake = await this.prisma.stocktake.findFirst({
      where: { id },
      include: STOCKTAKE_INCLUDE,
    });
    if (!stocktake) throw new NotFoundException('Stocktake not found');

    const onHand = await this.onHandByLine(
      stocktake.locationId,
      stocktake.lines.map((line) => line.productId),
    );

    // A posted count is history: its variance is what it *was*, so the stored
    // snapshot is the honest number. An open one is measured against live
    // stock, because that is what posting will actually compare.
    const live = stocktake.status === 'open';

    const lines = stocktake.lines.map((line) => {
      const expected = live
        ? (onHand.get(lineKey(line.productId, line.variantId)) ?? 0)
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
   * Counting the same product (or option) twice replaces the first line rather
   * than adding a second: a recount is a correction, not a second opinion.
   */
  async count(id: string, input: CountLinesDto): Promise<StocktakeView> {
    const stocktake = await this.requireOpen(id);
    const organizationId = TenantContext.requireOrganizationId();
    const countedByUserId = TenantContext.get()?.userId ?? null;

    await this.assertCountable(input.lines);
    const onHand = await this.onHandByLine(
      stocktake.locationId,
      input.lines.map((line) => line.productId),
    );

    // Update-then-create rather than `upsert`: "one line per product (and
    // option)" is a pair of partial unique indexes now (§24), which a Prisma
    // upsert cannot name. `variantId` is in the where as null when there is
    // none, so a recount finds the line it corrects. In order, so the same
    // product twice in one request still ends as one line, the later count.
    await this.prisma.$transaction(async (tx) => {
      for (const line of input.lines) {
        const where = {
          stocktakeId: id,
          productId: line.productId,
          variantId: line.variantId ?? null,
        };
        const counted = {
          countedQuantity: line.countedQuantity,
          // Snapshotted so the sheet still explains itself weeks later, when
          // stock has moved on. It is evidence, not the arithmetic.
          expectedQuantity:
            onHand.get(lineKey(line.productId, line.variantId)) ?? 0,
          note: line.note ?? null,
          countedByUserId,
        };
        const { count } = await tx.stocktakeLine.updateMany({
          where,
          data: { ...counted, countedAt: new Date() },
        });
        if (count === 0) {
          await tx.stocktakeLine.create({
            data: { organizationId, ...where, ...counted },
          });
        }
      }
    });

    return this.findOne(id);
  }

  /**
   * Removes a line counted by mistake. For a product with options, the option
   * says which line; without one, the line that names none.
   */
  async removeLine(
    id: string,
    productId: string,
    variantId?: string,
  ): Promise<StocktakeView> {
    await this.requireOpen(id);

    const line = await this.prisma.stocktakeLine.findFirst({
      where: { stocktakeId: id, productId, variantId: variantId ?? null },
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
   *
   * **Within one product, a shortfall in one option and a surplus in another
   * is a move, not a loss and a find** (owner, 2026-10-08). The usual cause is
   * stock put on one option when the product's options were added — 100
   * cartons on Chicken that the shelf says are 40 Chicken, 30 Onion, 30 Pepper.
   * That part moves on the **same lots**, as `transfer_out`/`transfer_in`
   * sharing a `transferGroupId`, exactly as `StockService.moveIntoVariant`
   * put it there: nothing is re-costed, and the value is unchanged. Only what
   * the product as a whole is short or over is written off or on.
   */
  async post(id: string): Promise<PostedStocktakeView> {
    const stocktake = await this.requireOpen(id);

    if (stocktake.lines.length === 0) {
      throw new ConflictException(
        'Nothing has been counted, so there is nothing to post.',
      );
    }

    const posted = await this.prisma.$transaction(async (tx) => {
      const writer = tx as unknown as StockWriter;
      await this.assertCountable(stocktake.lines, { posting: true }, tx);
      const onHand = await this.onHandByLine(
        stocktake.locationId,
        stocktake.lines.map((line) => line.productId),
        tx,
      );

      // Only the lines that disagree, by product: a move between options can
      // only happen inside one product.
      const byProduct = new Map<string, Variance[]>();
      for (const line of stocktake.lines) {
        const expected = onHand.get(lineKey(line.productId, line.variantId));
        const variance = line.countedQuantity - (expected ?? 0);
        if (variance === 0) continue;
        byProduct.set(line.productId, [
          ...(byProduct.get(line.productId) ?? []),
          { line, variance },
        ]);
      }

      let corrections = 0;
      for (const [productId, variances] of byProduct) {
        await this.postProduct(tx, writer, stocktake, productId, variances);
        corrections += variances.length;
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

  /**
   * One product's corrections. What its short options lost and its over
   * options gained, up to the smaller of the two, moves between them on the
   * lots it left from; the rest is written off (FEFO) or on (`batchForSurplus`).
   * A product without options has one line, so it never moves anything.
   */
  private async postProduct(
    tx: Pick<TenantPrisma, 'stockBalance' | 'stockBatch'>,
    writer: StockWriter,
    stocktake: { id: string; locationId: string },
    productId: string,
    variances: readonly Variance[],
  ) {
    const short = variances.filter((v) => v.variance < 0);
    const over = variances.filter((v) => v.variance > 0);
    let toMove = Math.min(
      short.reduce((sum, v) => sum - v.variance, 0),
      over.reduce((sum, v) => sum + v.variance, 0),
    );
    const transferGroupId = toMove > 0 ? randomUUID() : undefined;

    const movement = (line: StocktakeLine) => ({
      productId,
      variantId: line.variantId,
      locationId: stocktake.locationId,
      reason: StockAdjustmentReason.count_correction,
      note: line.note ?? undefined,
      referenceType: 'stocktake',
      referenceId: stocktake.id,
    });

    // The lots the moving part left, lot for lot, for the other options to
    // arrive on. A count can never be short by more than is there (counted is
    // at least zero), so the pick has no shortfall and this adds up exactly.
    const freed: { batchId: string; quantity: number }[] = [];

    for (const { line, variance } of short) {
      const moving = Math.min(toMove, -variance);
      toMove -= moving;
      if (moving > 0) {
        const out = await this.stock.recordOutbound(
          {
            ...movement(line),
            quantity: moving,
            type: StockMovementType.transfer_out,
            transferGroupId,
          },
          writer,
        );
        for (const left of out) {
          freed.push({ batchId: left.batchId, quantity: -left.quantity });
        }
      }
      if (-variance > moving) {
        await this.stock.recordOutbound(
          {
            ...movement(line),
            quantity: -variance - moving,
            type: StockMovementType.adjustment,
          },
          writer,
        );
      }
    }

    for (const { line, variance } of over) {
      let wanted = variance;
      while (wanted > 0 && freed.length > 0) {
        const lot = freed[0];
        const taking = Math.min(wanted, lot.quantity);
        await this.stock.recordInbound(
          {
            ...movement(line),
            batchId: lot.batchId,
            quantity: taking,
            type: StockMovementType.transfer_in,
            transferGroupId,
          },
          writer,
        );
        lot.quantity -= taking;
        wanted -= taking;
        if (lot.quantity === 0) freed.shift();
      }
      if (wanted > 0) {
        await this.stock.recordInbound(
          {
            ...movement(line),
            batchId: await this.batchForSurplus(
              tx,
              productId,
              stocktake.locationId,
            ),
            quantity: wanted,
            type: StockMovementType.adjustment,
          },
          writer,
        );
      }
    }
  }

  /** Abandons a count. The lines are kept; nothing reaches the ledger. */
  async cancel(id: string): Promise<StocktakeView> {
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
   *
   * The lot is the product's, whichever option holds it (§24: the option is on
   * the movement, never the lot), so this looks across every option's balance
   * on purpose — the one `where` on balances that leaves `variantId` out. The
   * movement written onto the lot names the option.
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
      // A lot that received nothing — a delivery line corrected to zero, or
      // moved to the right product — has no cost to lend a found item.
      where: { productId, quantityReceived: { gt: 0 } },
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

  /**
   * Base units on hand at one location per product and option, keyed by
   * `lineKey` — each option is counted on its own.
   */
  private async onHandByLine(
    locationId: string,
    productIds: string[],
    tx: Pick<TenantPrisma, 'stockBalance'> = this.prisma,
  ) {
    if (productIds.length === 0) return new Map<string, number>();

    const balances = await tx.stockBalance.groupBy({
      by: ['productId', 'variantId'],
      where: { locationId, productId: { in: [...new Set(productIds)] } },
      _sum: { quantity: true },
    });

    return new Map(
      balances.map((row) => [
        lineKey(row.productId, row.variantId),
        row._sum.quantity ?? 0,
      ]),
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

  /**
   * Every line names a stocked product and, for a product with options, one of
   * its options (`checkVariant`; a retired option's leftover stock may still be
   * counted). Checked when counting, so the problem is named then rather than
   * at posting — and again at posting, for a product that gained options after
   * it was counted: that line names none, and the stock is in an option now.
   */
  private async assertCountable(
    lines: readonly { productId: string; variantId?: string | null }[],
    options: { posting?: boolean } = {},
    db: Pick<TenantPrisma, 'product'> = this.prisma,
  ) {
    const found = await db.product.findMany({
      where: {
        id: { in: [...new Set(lines.map((line) => line.productId))] },
        // A product retired since it was counted still posts.
        ...(!options.posting && { deletedAt: null }),
      },
      select: {
        id: true,
        name: true,
        trackStock: true,
        variants: { select: { id: true, name: true, isActive: true } },
      },
    });

    const byId = new Map(found.map((product) => [product.id, product]));
    for (const line of lines) {
      const product = byId.get(line.productId);
      if (!product) {
        if (options.posting) continue;
        throw new NotFoundException(`Product ${line.productId} not found`);
      }
      // Counting a service would post an adjustment for something the ledger
      // deliberately ignores.
      if (!options.posting && !product.trackStock) {
        throw new ConflictException(
          `Product ${line.productId} is not stocked, so it cannot be counted.`,
        );
      }
      if (options.posting && !line.variantId && product.variants.length > 0) {
        throw new BadRequestException(
          `"${product.name}" was counted before it had options. Remove that line and count it by option.`,
        );
      }
      checkVariant(product.name, product.variants, line.variantId, {
        allowRetired: true,
      });
    }
  }
}
