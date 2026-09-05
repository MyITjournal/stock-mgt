import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import {
  OrgRole,
  StockAdjustmentReason,
  StockMovement,
  StockMovementType,
} from '@prisma/client';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { allocateFefo, sortFefo } from './fefo';

/**
 * The subset of the client the ledger writes through, so the same code runs
 * against `TenantPrisma` and against a transaction client — the two share these
 * delegates but not `$transaction`.
 */
export type StockWriter = Pick<
  TenantPrisma,
  'stockMovement' | 'stockBalance' | 'stockBatch'
>;

/** Who may push a movement through a shortfall. */
const FORCE_ROLES: OrgRole[] = [OrgRole.owner, OrgRole.manager];

export interface MovementInput {
  /** Client-supplied id, so an offline device can mint the row identity. */
  id?: string;
  productId: string;
  locationId: string;
  quantity: number;
  type: StockMovementType;
  reason?: StockAdjustmentReason;
  note?: string;
  /** When it happened by the device clock; defaults to now. */
  occurredAt?: Date;
  referenceType?: string;
  referenceId?: string;
  transferGroupId?: string;
}

export interface InboundInput extends MovementInput {
  batchId: string;
}

/**
 * What a pick cost, and how much of that is a guess.
 *
 * Two numbers rather than one because the difference matters: cost taken from
 * an invoice is a fact, and cost taken from the last known rate is an estimate
 * standing in for paperwork that had not arrived yet. A margin built on the
 * second kind should be able to say so.
 */
export interface PickCost {
  /** The exact fraction. Rounding belongs to whoever writes the number down. */
  cost: number;
  /** The part of `cost` that came from an estimated rate. */
  estimated: number;
}

export interface OutboundInput extends MovementInput {
  /** Pin a specific batch instead of letting FEFO choose. */
  batchId?: string;
  /** Record the movement even though stock does not cover it. */
  force?: boolean;
  forcedReason?: string;
}

/**
 * Every write into the stock ledger goes through here.
 *
 * ## Negative stock
 *
 * The ledger *records*; it does not judge. Refusing to store a movement is how
 * a stock count stops reconciling with reality, and an offline sale that syncs
 * at 5pm already happened at 9am — the goods have left the shop and cannot be
 * un-sold.
 *
 * So the policy lives in the write path, not in the table: an outbound movement
 * that stock does not cover is refused with a 409 naming the shortfall, and an
 * owner or manager may override it with `force` plus a reason. The override is
 * stored on the movement, which turns "we sold stock we had not entered yet"
 * into a line on a report instead of a number nobody can explain.
 */
@Injectable()
export class StockService {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma) {}

  /** Runs `fn` in a transaction — balances must move with their movements. */
  transaction<T>(fn: (tx: StockWriter) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => fn(tx as unknown as StockWriter));
  }

  /**
   * Stock in: a receipt, a customer return, a positive adjustment, the arriving
   * half of a transfer. The batch must already exist — inbound stock always has
   * a lot it belongs to, even when that lot was invented for an opening balance.
   */
  async recordInbound(input: InboundInput, db: StockWriter = this.prisma) {
    assertPositive(input.quantity);

    const movement = await db.stockMovement.create({
      data: {
        ...(input.id && { id: input.id }),
        organizationId: TenantContext.requireOrganizationId(),
        productId: input.productId,
        locationId: input.locationId,
        batchId: input.batchId,
        type: input.type,
        quantity: input.quantity,
        reason: input.reason ?? null,
        note: input.note ?? null,
        occurredAt: input.occurredAt ?? new Date(),
        recordedByUserId: TenantContext.get()?.userId ?? null,
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        transferGroupId: input.transferGroupId ?? null,
      },
    });

    await this.applyToBalance(db, input, input.batchId, input.quantity);
    return movement;
  }

  /**
   * Stock out: a sale, damage, a negative adjustment, the leaving half of a
   * transfer. Picks FEFO unless a batch is named, and writes one movement per
   * batch it draws from, so the ledger says which lot actually left.
   */
  async recordOutbound(input: OutboundInput, db: StockWriter = this.prisma) {
    assertPositive(input.quantity);

    const available = await this.availableBatches(
      db,
      input.productId,
      input.locationId,
      input.batchId,
    );
    const { allocations, shortfall } = allocateFefo(available, input.quantity);

    if (shortfall > 0) {
      const onHand = input.quantity - shortfall;
      if (!input.force) {
        throw new ConflictException(
          `Not enough stock: ${input.quantity} requested, ${onHand} available, short by ${shortfall}. An owner or manager can record it anyway with "force".`,
        );
      }
      this.assertMayForce(input.forcedReason);

      allocations.push({
        batchId: await this.batchToBearShortfall(db, input),
        quantity: shortfall,
      });
    }

    const forced = shortfall > 0;
    const occurredAt = input.occurredAt ?? new Date();
    const recordedByUserId = TenantContext.get()?.userId ?? null;
    const organizationId = TenantContext.requireOrganizationId();
    const movements: StockMovement[] = [];

    for (const [index, allocation] of allocations.entries()) {
      const movement = await db.stockMovement.create({
        data: {
          // The client-supplied id names the first movement; a pick that spans
          // batches mints the rest, since the client could not know how many.
          ...(index === 0 && input.id && { id: input.id }),
          organizationId,
          productId: input.productId,
          locationId: input.locationId,
          batchId: allocation.batchId,
          type: input.type,
          quantity: -allocation.quantity,
          reason: input.reason ?? null,
          note: input.note ?? null,
          occurredAt,
          recordedByUserId,
          referenceType: input.referenceType ?? null,
          referenceId: input.referenceId ?? null,
          transferGroupId: input.transferGroupId ?? null,
          isForced: forced,
          forcedReason: forced ? (input.forcedReason ?? null) : null,
        },
      });
      movements.push(movement);

      await this.applyToBalance(
        db,
        input,
        allocation.batchId,
        -allocation.quantity,
      );
    }

    return movements;
  }

  /**
   * What a set of movements cost to buy, as an **exact fraction**.
   *
   * Batch cost is inventory's business, not the caller's, so the arithmetic
   * lives here: each batch contributes `taken × totalCost / quantityReceived`,
   * the ratio §2 insists is computed rather than stored. The result is
   * deliberately fractional — the caller rounds **once**, when it writes the
   * figure down, which for a sale is onto the sale line.
   *
   * Movements from a batch that recorded nothing received contribute nothing:
   * those are the placeholder batches a forced movement leaves behind, and they
   * have no invoice to divide.
   */
  async costOf(
    movements: readonly Pick<StockMovement, 'batchId' | 'quantity'>[],
    db: StockWriter = this.prisma,
  ): Promise<PickCost> {
    const batchIds = [...new Set(movements.map((m) => m.batchId))];
    if (batchIds.length === 0) return { cost: 0, estimated: 0 };

    const batches = await db.stockBatch.findMany({
      where: { id: { in: batchIds } },
      select: {
        id: true,
        productId: true,
        totalCost: true,
        quantityReceived: true,
      },
    });
    const byId = new Map(batches.map((batch) => [batch.id, batch]));

    // A batch that received nothing is a placeholder invented to carry a
    // forced shortfall — it has no invoice, so its rate has to come from
    // somewhere else.
    const needEstimate = [
      ...new Set(
        batches
          .filter((batch) => batch.quantityReceived <= 0)
          .map((batch) => batch.productId),
      ),
    ];
    const estimates = await this.lastKnownRates(db, needEstimate);

    let cost = 0;
    let estimated = 0;

    for (const movement of movements) {
      const batch = byId.get(movement.batchId);
      if (!batch) continue;

      const units = Math.abs(movement.quantity);

      if (batch.quantityReceived > 0) {
        cost += (units * batch.totalCost) / batch.quantityReceived;
        continue;
      }

      const amount = units * (estimates.get(batch.productId) ?? 0);
      cost += amount;
      estimated += amount;
    }

    return { cost, estimated };
  }

  /**
   * What one base unit of each product cost on its most recent real delivery.
   *
   * Used only to price a forced movement that outran its paperwork. Zero when
   * the product has never been received at all, which is the one case where the
   * cost is genuinely unknown rather than merely unrecorded.
   */
  private async lastKnownRates(db: StockWriter, productIds: string[]) {
    const rates = new Map<string, number>();
    if (productIds.length === 0) return rates;

    const batches = await db.stockBatch.findMany({
      where: { productId: { in: productIds }, quantityReceived: { gt: 0 } },
      orderBy: { receivedAt: 'desc' },
      select: { productId: true, totalCost: true, quantityReceived: true },
    });

    for (const batch of batches) {
      if (!rates.has(batch.productId)) {
        rates.set(batch.productId, batch.totalCost / batch.quantityReceived);
      }
    }

    return rates;
  }

  /**
   * Batches with stock, ordered for picking. Reads the cached balance rather
   * than summing the ledger — that is what the cache is for.
   */
  private async availableBatches(
    db: StockWriter,
    productId: string,
    locationId: string,
    batchId?: string,
  ) {
    const balances = await db.stockBalance.findMany({
      where: {
        productId,
        locationId,
        quantity: { gt: 0 },
        ...(batchId && { batchId }),
      },
      include: {
        batch: { select: { expiryDate: true, receivedAt: true } },
      },
    });

    return balances.map((balance) => ({
      batchId: balance.batchId,
      quantity: balance.quantity,
      expiryDate: balance.batch.expiryDate,
      receivedAt: balance.batch.receivedAt,
    }));
  }

  private assertMayForce(forcedReason?: string) {
    const orgRole = TenantContext.get()?.orgRole;
    if (!orgRole || !FORCE_ROLES.includes(orgRole)) {
      throw new ForbiddenException(
        'Only an owner or manager can record stock movements that exceed what is on hand.',
      );
    }
    if (!forcedReason?.trim()) {
      throw new ConflictException(
        'Forcing a movement past a shortfall requires a reason.',
      );
    }
  }

  /**
   * Which batch carries the part that was not covered.
   *
   * The FEFO-preferred batch at that location, even if it is empty — the goods
   * that physically left were almost certainly from that lot. When the product
   * has never been received there at all, there is no lot to blame, so a batch
   * with nothing received and no cost is created to hang it on. Its
   * `quantityReceived = 0` is what marks it as one of these.
   */
  private async batchToBearShortfall(db: StockWriter, input: OutboundInput) {
    if (input.batchId) return input.batchId;

    const known = await db.stockBalance.findMany({
      where: { productId: input.productId, locationId: input.locationId },
      include: { batch: { select: { expiryDate: true, receivedAt: true } } },
    });

    if (known.length > 0) {
      const [first] = sortFefo(
        known.map((balance) => ({
          batchId: balance.batchId,
          quantity: balance.quantity,
          expiryDate: balance.batch.expiryDate,
          receivedAt: balance.batch.receivedAt,
        })),
      );
      return first.batchId;
    }

    const placeholder = await db.stockBatch.create({
      data: {
        organizationId: TenantContext.requireOrganizationId(),
        productId: input.productId,
        quantityReceived: 0,
        quantityPaidFor: 0,
        totalCost: 0,
      },
    });
    return placeholder.id;
  }

  /**
   * Moves the cached balance by `delta`.
   *
   * `updateMany` then `create` rather than `upsert`: the tenant extension
   * injects `organizationId` into the where clause, which `updateMany` accepts
   * and a strict unique upsert would not. Two transactions racing to create the
   * same balance row leave one of them with a unique violation, so that case
   * falls back to the update.
   */
  private async applyToBalance(
    db: StockWriter,
    input: MovementInput,
    batchId: string,
    delta: number,
  ) {
    const where = {
      productId: input.productId,
      locationId: input.locationId,
      batchId,
    };

    const { count } = await db.stockBalance.updateMany({
      where,
      data: { quantity: { increment: delta } },
    });
    if (count > 0) return;

    try {
      await db.stockBalance.create({
        data: {
          organizationId: TenantContext.requireOrganizationId(),
          ...where,
          quantity: delta,
        },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      await db.stockBalance.updateMany({
        where,
        data: { quantity: { increment: delta } },
      });
    }
  }
}

function assertPositive(quantity: number) {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new ConflictException(
      `Quantity must be a positive whole number of base units, got ${quantity}`,
    );
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}
