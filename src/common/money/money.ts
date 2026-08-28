/**
 * Money is stored as an integer count of minor units — kobo for NGN, cents for
 * USD — never as a float. `Organization.currency` says which currency those
 * minor units belong to.
 *
 * Prices are stored **tax-inclusive**: the stored figure is what the customer
 * pays. VAT is derived from it rather than stored alongside it, so the two can
 * never drift apart.
 */

/** Basis points: 750 = 7.5%. Integer, so the rate itself is exact. */
export type BasisPoints = number;

/** An amount in minor units. */
export type Minor = number;

const BPS_DENOMINATOR = 10_000;

export interface TaxSplit {
  /** What the customer pays. */
  gross: Minor;
  /** The portion excluding tax. */
  net: Minor;
  /** The tax portion. Always `gross - net`, so the parts sum exactly. */
  tax: Minor;
}

/**
 * Splits a tax-inclusive amount into its net and tax parts.
 *
 * `tax` is derived by subtraction rather than computed independently, which
 * guarantees `net + tax === gross` at every rounding boundary. Computing both
 * halves separately can lose or gain a kobo on odd amounts.
 */
export function splitTaxInclusive(
  gross: Minor,
  rateBps: BasisPoints,
): TaxSplit {
  assertMinor(gross);
  if (!Number.isInteger(rateBps) || rateBps < 0) {
    throw new RangeError(
      `Tax rate must be a non-negative integer, got ${rateBps}`,
    );
  }

  const net = Math.round(
    (gross * BPS_DENOMINATOR) / (BPS_DENOMINATOR + rateBps),
  );
  return { gross, net, tax: gross - net };
}

/** Adds tax to a net amount, for the rare case a supplier quotes ex-VAT. */
export function addTax(net: Minor, rateBps: BasisPoints): Minor {
  assertMinor(net);
  return net + Math.round((net * rateBps) / BPS_DENOMINATOR);
}

/**
 * Price of `quantity` base units at `unitPrice`.
 *
 * Integer throughout: the reason money is not a float is that this multiply,
 * repeated across a day of sales, is where the drift would show up.
 */
export function multiply(unitPrice: Minor, quantity: number): Minor {
  assertMinor(unitPrice);
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new RangeError(
      `Quantity must be a non-negative integer, got ${quantity}`,
    );
  }
  return unitPrice * quantity;
}

/** Applies a basis-point discount, rounding in the customer's favour. */
export function applyDiscount(amount: Minor, discountBps: BasisPoints): Minor {
  assertMinor(amount);
  return amount - Math.round((amount * discountBps) / BPS_DENOMINATOR);
}

/** Major units to minor: 25.50 -> 2550. Use only at the system's edges. */
export function toMinor(major: number, decimals = 2): Minor {
  return Math.round(major * 10 ** decimals);
}

/** Minor units to major: 2550 -> 25.5. Presentation only, never arithmetic. */
export function toMajor(minor: Minor, decimals = 2): number {
  assertMinor(minor);
  return minor / 10 ** decimals;
}

/** Formats for display, e.g. formatMinor(250000, 'NGN') -> "₦2,500.00". */
export function formatMinor(
  minor: Minor,
  currency: string,
  locale = 'en-NG',
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(toMajor(minor));
}

function assertMinor(value: number): void {
  if (!Number.isInteger(value)) {
    throw new RangeError(
      `Money must be an integer number of minor units, got ${value}`,
    );
  }
}
