import type { components } from '../api/schema';

type ProductView = components['schemas']['ProductView'];

/** A figure for one unit: "₦12,500 / carton". */
export interface PerUnit {
  unitId: string;
  unitName: string;
  amount: number;
}

/**
 * The price of the unit **the till picks first**, as the till would charge it
 * on the default price list — "₦12,500 / carton" (2026-10-07, owner: "use the
 * till picks first unit for both the cost and sales price").
 *
 * The server works out both the unit and the price (`tillUnit`), with the very
 * rule and pricing the till uses, so the products list can never name a
 * different unit or price from the one a cashier is handed. Nothing is chosen
 * or multiplied here. Null: the till sells no unit of it, or has no price.
 */
export function shelfPrice(product: ProductView): PerUnit | null {
  const till = product.tillUnit;
  return till && till.price !== null
    ? { unitId: till.unitId, unitName: till.unitName, amount: till.price }
    : null;
}

/**
 * What one of the till's first unit cost on the last delivery — a carton
 * beside a carton. From `unitCosts`, which the server works out from the lot's
 * exact total; nothing is multiplied here.
 *
 * `undefined` when the role may not see cost (the key was removed), `null`
 * when nothing has been delivered yet or the till sells no unit of it.
 */
export function costIn(product: ProductView): PerUnit | null | undefined {
  if (product.unitCosts === undefined) return undefined;
  const till = product.tillUnit;
  const cost = till
    ? product.unitCosts.find((row) => row.unitId === till.unitId)
    : undefined;
  return till && cost
    ? { unitId: till.unitId, unitName: till.unitName, amount: cost.cost }
    : null;
}
