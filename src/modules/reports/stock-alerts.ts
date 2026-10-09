/**
 * Out, low and negative stock — **one row per option** (§24, branch 5).
 *
 * **Running low is worked out from what sells** (owner, 2026-10-09): a product
 * is low once its stock will not last the shop's `lowStockDays` at the rate it
 * has been selling. "Three cartons of Milo in on the 1st, five rolls left on
 * the 12th, and five rolls will not see out the week" — so it is low, with
 * nobody having typed a level in. Most shops never set one, which left them
 * with no warnings at all.
 *
 * A **reorder level** somebody did type in still counts: below it is low too.
 * It is the only way a product that has not sold lately — nothing to measure
 * a rate from — is flagged before it runs out. The level and the rate apply to
 * **each option on its own** (owner, 2026-10-08): Pepper Soup running out shows
 * while Chicken is full.
 *
 * Quantities are summed **across locations** (§12): an empty van is not a
 * reason to reorder while the store is full. Selling is too — a move between
 * stores is not a sale.
 *
 * A **retired** option cannot be restocked, so it is never "out" or "low" — but
 * it is listed when negative, since that is a trail somebody must clear up.
 */

export interface AlertProduct {
  id: string;
  name: string;
  sku: string;
  reorderPoint: number | null;
  /** Carried onto each row so the count can be said in them. */
  units: readonly { name: string; factor: number }[];
  variants: readonly { id: string; name: string; isActive: boolean }[];
}

/** Summed balances for one (product, option). */
export interface HeldStock {
  productId: string;
  variantId: string | null;
  quantity: number;
}

/**
 * How fast one (product, option) has been selling: `sold` base units, net of
 * returns, over `days` local days — the last 30, or fewer when its first stock
 * arrived inside them (the service works the days out in the shop's timezone).
 */
export interface SalesSpeed {
  productId: string;
  variantId: string | null;
  sold: number;
  days: number;
}

/** Why a row is on the low list. */
export type LowReason = 'running_out' | 'below_level';

export interface AlertRow {
  id: string;
  name: string;
  sku: string;
  reorderPoint: number | null;
  variant: { id: string; name: string } | null;
  quantity: number;
  units: { name: string; factor: number }[];
  /** Base units sold, net of returns, over `windowDays`. 0 when none. */
  soldInWindow: number;
  windowDays: number;
  /** Whole days the stock lasts at that rate; null when nothing sold. */
  daysLeft: number | null;
  /** Set on a low row only. */
  reason: LowReason | null;
}

export interface StockAlerts {
  outOfStock: AlertRow[];
  lowStock: AlertRow[];
  negative: AlertRow[];
  withoutReorderPoint: number;
  /** The warning period the low list was measured against. */
  lowStockDays: number;
}

export function stockAlerts(
  products: readonly AlertProduct[],
  held: readonly HeldStock[],
  speeds: readonly SalesSpeed[] = [],
  lowStockDays = 7,
): StockAlerts {
  const keyOf = (productId: string, variantId: string | null) =>
    `${productId}|${variantId ?? ''}`;

  const onHand = new Map<string, number>();
  for (const row of held) {
    const key = keyOf(row.productId, row.variantId);
    onHand.set(key, (onHand.get(key) ?? 0) + row.quantity);
  }
  const speedOf = new Map(
    speeds.map((row) => [keyOf(row.productId, row.variantId), row]),
  );

  const rows: AlertRow[] = [];
  const retired = new Set<AlertRow>();
  for (const product of products) {
    const items =
      product.variants.length === 0
        ? [{ variant: null, isActive: true }]
        : product.variants.map((variant) => ({
            variant: { id: variant.id, name: variant.name },
            isActive: variant.isActive,
          }));

    for (const { variant, isActive } of items) {
      const key = keyOf(product.id, variant?.id ?? null);
      const quantity = onHand.get(key) ?? 0;
      const speed = speedOf.get(key);
      // Net of returns, so more back than out reads as nothing sold.
      const sold = Math.max(0, speed?.sold ?? 0);
      const days = speed?.days ?? 0;
      const row: AlertRow = {
        id: product.id,
        name: product.name,
        sku: product.sku,
        reorderPoint: product.reorderPoint,
        variant,
        quantity,
        units: [...product.units],
        soldInWindow: sold,
        windowDays: days,
        daysLeft:
          sold > 0 && days > 0 && quantity > 0
            ? Math.floor((quantity * days) / sold)
            : null,
        reason: lowReason(
          quantity,
          sold,
          days,
          product.reorderPoint,
          lowStockDays,
        ),
      };
      rows.push(row);
      if (!isActive) retired.add(row);
    }
  }

  const live = rows.filter((row) => !retired.has(row));
  const low = live.filter((row) => row.reason !== null);

  return {
    outOfStock: live.filter((row) => row.quantity === 0),
    // Soonest gone first; a row that is only below a typed level has no
    // rate to rank by, so those follow.
    lowStock: [
      ...low
        .filter((row) => row.reason === 'running_out')
        .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0)),
      ...low.filter((row) => row.reason === 'below_level'),
    ],
    negative: rows.filter((row) => row.quantity < 0),
    // Products, not options: the level is set once per product.
    withoutReorderPoint: products.filter(
      (product) => product.reorderPoint === null,
    ).length,
    lowStockDays,
  };
}

/**
 * Low is strictly above empty — empty and below are their own lists.
 *
 * "Will not last `lowStockDays`" is `quantity / (sold / days) < lowStockDays`,
 * multiplied out so it stays in whole numbers: `quantity × days < sold ×
 * lowStockDays`. A level of 0 means "tell me when it runs out", which the out
 * of stock list already does.
 */
function lowReason(
  quantity: number,
  sold: number,
  days: number,
  reorderPoint: number | null,
  lowStockDays: number,
): LowReason | null {
  if (quantity <= 0) return null;
  if (sold > 0 && days > 0 && quantity * days < sold * lowStockDays) {
    return 'running_out';
  }
  if (reorderPoint !== null && quantity <= reorderPoint) return 'below_level';
  return null;
}
