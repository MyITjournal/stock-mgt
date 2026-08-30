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
  basePrice: Minor;
  taxRateBps: number;
  prices: readonly { tierId: string; unitId: string; price: Minor }[];
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
) {
  const tiered = tierId
    ? product.prices.find(
        (row) => row.tierId === tierId && row.unitId === unit.id,
      )
    : undefined;

  // No tier price for this unit falls back to the base price scaled by the
  // factor. That is a *fallback*, not the rule: a carton is normally cheaper
  // per piece, which is why ProductPrice is keyed by unit at all (§4).
  const price = tiered ? tiered.price : product.basePrice * unit.factor;

  return {
    unitId: unit.id,
    unitName: unit.name,
    baseQuantity: unit.factor,
    price,
    isTierPrice: Boolean(tiered),
    tax: splitTaxInclusive(price, product.taxRateBps),
  };
}
