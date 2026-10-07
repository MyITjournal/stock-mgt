/**
 * What each selling unit would make at today's price and today's cost
 * (2026-10-07) — a projection to decide prices by, not a record of anything.
 *
 * **The cost is the average of the stock on hand** (owner's choice): what the
 * goods on the shelf actually cost, old and new deliveries together, worked out
 * from lot totals exactly as stock valuation is (§2) — `Σ onHand × totalCost ÷
 * quantityReceived`, divided by what is on hand, and rounded once, at the
 * selling unit. Free goods need no special case: a "buy 12 get 1 free" lot has
 * one more piece for the same total, so every piece in it costs less.
 *
 * With nothing on hand there is no average; the last delivery's cost is used
 * instead and the row says so — a sold-out product still needs a price.
 *
 * **The margin is on the price without VAT**, the same rule the profit report
 * follows: VAT inside a price was never the shop's money. A shop that does not
 * charge VAT keeps the whole price.
 */
import { Minor, splitTaxInclusive } from '../../common/money/money';
import { marginBps } from './profit';
import { lotValue, type ValuedLot } from './valuation';

/**
 * The exact, unrounded average cost of one base unit across the lots on hand,
 * or null when nothing is.
 *
 * Only lots holding stock count. A lot driven negative — goods sold before
 * their delivery was recorded (§5) — holds nothing to average, and letting it
 * subtract would make the cost of what *is* on the shelf come out wrong.
 */
export function averageUnitCost(lots: readonly ValuedLot[]): number | null {
  const held = lots.filter((lot) => lot.quantity > 0);
  const onHand = held.reduce((total, lot) => total + lot.quantity, 0);
  if (onHand <= 0) return null;
  return held.reduce((total, lot) => total + lotValue(lot), 0) / onHand;
}

/**
 * What one selling unit makes: its price without VAT, less its cost.
 *
 * `taxRateBps` is the rate a sale would record today — the product's rate, or
 * 0 for a shop that does not charge VAT. `unitCost` is already rounded, for the
 * whole selling unit.
 */
export function unitMargin(input: {
  price: Minor;
  taxRateBps: number;
  unitCost: Minor;
}): { netPrice: Minor; margin: Minor; marginBps: number } {
  const netPrice =
    input.price - splitTaxInclusive(input.price, input.taxRateBps).tax;
  const margin = netPrice - input.unitCost;
  return { netPrice, margin, marginBps: marginBps(margin, netPrice) };
}

/**
 * A delivery's free goods as the deal a person would say: 312 received for 288
 * paid becomes "13 for 12". Null when nothing came free.
 */
export function dealOf(
  received: number,
  paidFor: number,
): { received: number; paidFor: number } | null {
  if (received <= paidFor || paidFor <= 0) return null;
  const divisor = gcd(received, paidFor);
  return { received: received / divisor, paidFor: paidFor / divisor };
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
