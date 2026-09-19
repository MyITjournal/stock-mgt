/**
 * Money on the screen.
 *
 * Every monetary value crossing the API is an **integer count of minor units**
 * — kobo for NGN — because binary floating point cannot represent a tenth
 * (DECISIONS.md §2). This module turns those integers into something a person
 * reads, and does nothing else.
 *
 * **The rule this file exists to hold: money is displayed here, never computed
 * here.** Totals, tax, cost of goods sold, balances and allocations are all
 * worked out on the server, where there is exactly one implementation of each.
 * A second implementation in the browser is how a dashboard comes to disagree
 * with the receipt it printed.
 *
 * The single bounded exception is the till's running total, and it is safe for
 * a reason specific to this product: prices are stored **tax-inclusive**, so a
 * line preview is `unitPrice × quantity` — exact integer multiplication, no tax
 * arithmetic and no rounding. See `previewLineTotal` below.
 */

/** An integer count of minor units. Never a float, never a decimal string. */
export type Minor = number;

/**
 * What is shown where a figure is absent.
 *
 * Not "0", and the difference matters. A rep reading a sale gets no
 * `costOfGoodsSold` at all — `redactCost` on the server *removes* the key
 * rather than nulling it (§9) — and rendering that as zero would say the goods
 * were free.
 */
export const ABSENT = '—';

const formatters = new Map<string, Intl.NumberFormat>();

function formatterFor(currency: string): Intl.NumberFormat {
  let formatter = formatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    formatters.set(currency, formatter);
  }
  return formatter;
}

/**
 * Formats minor units for display: `199800` becomes `₦1,998.00`.
 *
 * Returns {@link ABSENT} for null or undefined, which is the common case rather
 * than an edge one — see the note on `ABSENT`.
 *
 * The division by 100 is the one place a monetary value becomes a float, and it
 * is safe **only because nothing computes with the result**. It is handed
 * straight to `Intl.NumberFormat`, which rounds to two places, and every
 * monetary field is bounded at `int4` (2,147,483,647) by `MAX_MINOR_UNITS` on
 * the server — comfortably inside the range where this round-trips exactly.
 */
export function formatMoney(
  value: Minor | null | undefined,
  currency = 'NGN',
): string {
  if (value === null || value === undefined) return ABSENT;
  if (!Number.isFinite(value)) return ABSENT;
  return formatterFor(currency).format(value / 100);
}

/**
 * The till's running total for one line, in minor units.
 *
 * Exact: both operands are integers and prices are tax-inclusive, so there is
 * no tax to split and nothing to round. **This is a preview.** The authoritative
 * line total, tax amount, cost of goods sold and invoice total all come back
 * from `POST /sales`, and the receipt renders those. A preview that disagrees
 * with the receipt is a bug, not a rounding difference.
 */
export function previewLineTotal(unitPrice: Minor, quantity: number): Minor {
  return unitPrice * quantity;
}

/** Sums previews for a cart. Same contract as `previewLineTotal`. */
export function previewTotal(lines: readonly { lineTotal: Minor }[]): Minor {
  return lines.reduce((total, line) => total + line.lineTotal, 0);
}

/**
 * Parses what somebody typed into minor units: `"1,998.00"` becomes `199800`.
 *
 * Returns null for anything that is not a plain amount, so a caller has to
 * decide what to do rather than receiving a silent `NaN`. Rounds to the nearest
 * minor unit, because a person typing three decimal places into a price field
 * has made a mistake this cannot resolve.
 */
export function parseMoney(input: string): Minor | null {
  const cleaned = input.replace(/[\s,]/g, '').replace(/^₦/, '');
  if (!/^-?\d*\.?\d*$/.test(cleaned) || cleaned === '' || cleaned === '-') {
    return null;
  }
  const major = Number(cleaned);
  if (!Number.isFinite(major)) return null;
  return Math.round(major * 100);
}
