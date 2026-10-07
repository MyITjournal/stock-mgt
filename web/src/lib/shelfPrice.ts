import type { components } from '../api/schema';

type ProductView = components['schemas']['ProductView'];

/** A figure for one unit: "₦12,500 / carton". */
export interface PerUnit {
  unitId: string;
  unitName: string;
  amount: number;
}

/**
 * The price a customer is told: the default selling unit's price on the
 * default price list — "₦12,500 / carton". Only when that unit has none does
 * the base price show, per counted-in unit; it is never multiplied up here,
 * because the browser never works out a price (§17). Null: no price at all.
 *
 * "Base price" used to be the column, and a catalog priced by its units —
 * which an import makes — showed a dash on every row (2026-10-07).
 */
export function shelfPrice(
  product: ProductView,
  defaultTierId: string | undefined,
): PerUnit | null {
  const unit =
    product.units.find((row) => row.isDefaultSelling) ??
    product.units.find((row) => row.isSellable);
  const listed =
    unit && defaultTierId
      ? product.prices.find(
          (row) => row.tierId === defaultTierId && row.unitId === unit.id,
        )
      : undefined;
  if (unit && listed) {
    return { unitId: unit.id, unitName: unit.name, amount: listed.price };
  }
  const base = product.units.find((row) => row.isBase);
  return product.basePrice !== null && base
    ? { unitId: base.id, unitName: base.name, amount: product.basePrice }
    : null;
}

/**
 * What one of a unit cost on the last delivery, **in the same unit the price
 * is shown in** — a carton beside a carton (2026-10-07, owner: a wholesaler
 * does not think in pieces). The server works it out from the lot's exact
 * total (`unitCosts`); nothing is multiplied here.
 *
 * `undefined` when the role may not see cost (the key was removed), `null`
 * when nothing has been delivered yet.
 */
export function costIn(
  product: ProductView,
  unitId: string | undefined,
): PerUnit | null | undefined {
  if (product.unitCosts === undefined) return undefined;
  const unit =
    product.units.find((row) => row.id === unitId) ??
    product.units.find((row) => row.isDefaultSelling) ??
    product.units.find((row) => row.isBase);
  const cost = unit
    ? product.unitCosts.find((row) => row.unitId === unit.id)
    : undefined;
  return unit && cost
    ? { unitId: unit.id, unitName: unit.name, amount: cost.cost }
    : null;
}
