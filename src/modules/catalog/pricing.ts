import { Minor, splitTaxInclusive } from '../../common/money/money';

/**
 * What one unit of a product costs a given tier.
 *
 * Pure, and separate from `ProductService`, because two callers need the same
 * answer from data they have already loaded: the catalog's `/price` endpoint,
 * and selling — which holds the product anyway and should not fetch it twice
 * to be told the price of something it is already looking at.
 */
export interface PricedProduct {
  /** Null when the product has no fallback price — see resolveUnitPrice. */
  basePrice: Minor | null;
  taxRateBps: number;
  prices: readonly {
    tierId: string;
    unitId: string;
    /** Set on an option's own price; null or absent is the product's. */
    variantId?: string | null;
    price: Minor;
  }[];
}

export interface PricedUnit {
  id: string;
  name: string;
  factor: number;
}

export function resolveUnitPrice(
  product: PricedProduct,
  unit: PricedUnit,
  tierId?: string,
  /**
   * The option being priced. Its own price for this unit and tier wins; with
   * none, it sells at the product's — the owner's rule of 2026-10-08, so ten
   * flavours at one price are priced once. An option's price never stands in
   * for the product's, or for another option's.
   */
  variantId?: string | null,
) {
  const onTier = (row: PricedProduct['prices'][number]) =>
    row.tierId === tierId && row.unitId === unit.id;
  const tiered = tierId
    ? ((variantId
        ? product.prices.find(
            (row) => onTier(row) && row.variantId === variantId,
          )
        : undefined) ??
      product.prices.find((row) => onTier(row) && !row.variantId))
    : undefined;

  // No tier price for this unit falls back to the base price scaled by the
  // factor. That is a *fallback*, not the rule: a carton is normally cheaper
  // per piece, which is why ProductPrice is keyed by unit at all (§4).
  //
  // And with no base price there is no fallback at all: the price is null,
  // and the till refuses to sell the unit until somebody gives it one. Never
  // a guess — a half carton of Peak guessed from a sachet price came out at
  // ₦2,100 against a real ₦20,500.
  const price = tiered
    ? tiered.price
    : product.basePrice === null
      ? null
      : product.basePrice * unit.factor;

  return {
    unitId: unit.id,
    unitName: unit.name,
    baseQuantity: unit.factor,
    price,
    isTierPrice: Boolean(tiered),
    tax: price === null ? null : splitTaxInclusive(price, product.taxRateBps),
  };
}
