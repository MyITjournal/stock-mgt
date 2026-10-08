/**
 * Out, low and negative stock — **one row per option** (§24, branch 5).
 *
 * Owner, 2026-10-08: the product's reorder level applies to **each option on
 * its own**. A level of 5 cartons on Indomie means "tell me when any flavour is
 * down to 5", so Pepper Soup running out shows while Chicken is full. Summed
 * across the options, ten flavours at 5 cartons each would read as a healthy 50
 * with every one of them due. There is no level per option: that would be a box
 * on every option for a number that is nearly always the product's.
 *
 * Quantities are still summed **across locations** (§12): an empty van is not a
 * reason to reorder while the store is full.
 *
 * A **retired** option cannot be restocked, so it is never "out" or "low" — but
 * it is listed when negative, since that is a trail somebody must clear up.
 */

export interface AlertProduct {
  id: string;
  name: string;
  sku: string;
  reorderPoint: number | null;
  variants: readonly { id: string; name: string; isActive: boolean }[];
}

/** Summed balances for one (product, option). */
export interface HeldStock {
  productId: string;
  variantId: string | null;
  quantity: number;
}

export interface AlertRow {
  id: string;
  name: string;
  sku: string;
  reorderPoint: number | null;
  variant: { id: string; name: string } | null;
  quantity: number;
}

export interface StockAlerts {
  outOfStock: AlertRow[];
  lowStock: AlertRow[];
  negative: AlertRow[];
  withoutReorderPoint: number;
}

export function stockAlerts(
  products: readonly AlertProduct[],
  held: readonly HeldStock[],
): StockAlerts {
  const onHand = new Map<string, number>();
  for (const row of held) {
    const key = `${row.productId}|${row.variantId ?? ''}`;
    onHand.set(key, (onHand.get(key) ?? 0) + row.quantity);
  }
  const quantityOf = (productId: string, variantId: string | null) =>
    onHand.get(`${productId}|${variantId ?? ''}`) ?? 0;

  const rows: AlertRow[] = [];
  const retired = new Set<AlertRow>();
  for (const product of products) {
    const base = {
      id: product.id,
      name: product.name,
      sku: product.sku,
      reorderPoint: product.reorderPoint,
    };
    if (product.variants.length === 0) {
      rows.push({
        ...base,
        variant: null,
        quantity: quantityOf(product.id, null),
      });
      continue;
    }
    for (const variant of product.variants) {
      const row: AlertRow = {
        ...base,
        variant: { id: variant.id, name: variant.name },
        quantity: quantityOf(product.id, variant.id),
      };
      rows.push(row);
      if (!variant.isActive) retired.add(row);
    }
  }

  const live = rows.filter((row) => !retired.has(row));

  return {
    outOfStock: live.filter((row) => row.quantity === 0),
    // A level of 0 means "tell me when it runs out", which the line above
    // already covers, so low stock is strictly above empty.
    lowStock: live.filter(
      (row) =>
        row.reorderPoint !== null &&
        row.quantity > 0 &&
        row.quantity <= row.reorderPoint,
    ),
    negative: rows.filter((row) => row.quantity < 0),
    // Products, not options: the level is set once per product.
    withoutReorderPoint: products.filter(
      (product) => product.reorderPoint === null,
    ).length,
  };
}
