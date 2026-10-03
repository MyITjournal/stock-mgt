/**
 * Working out a part of a unit — half a carton, a sixth of a carton — as a
 * unit of its own.
 *
 * A portion is not a fraction of a quantity. It is a unit like any other, with
 * its own factor and its own price, because in this trade half a carton is
 * rarely exactly half the carton price. That keeps every quantity a whole
 * number, which the stock ledger depends on (§2, §5).
 *
 * This only does the arithmetic and the naming the form would otherwise leave
 * to somebody with a calculator. The result is an ordinary unit row; nothing
 * on the server knows it was made this way.
 */

export interface Fraction {
  /** What the picker shows. */
  label: string;
  /** What the unit is named with — see `portionName`. */
  text: string;
  numerator: number;
  denominator: number;
}

export const FRACTIONS: readonly Fraction[] = [
  { label: '½', text: '1/2', numerator: 1, denominator: 2 },
  { label: '⅓', text: '1/3', numerator: 1, denominator: 3 },
  { label: '¼', text: '1/4', numerator: 1, denominator: 4 },
  { label: '⅙', text: '1/6', numerator: 1, denominator: 6 },
];

/**
 * "1/2 carton", never "½ carton". The name prints on PDF invoices and thermal
 * receipts, and the PDF's built-in fonts have no ⅓ or ⅙ — the same reason
 * money prints as NGN rather than ₦. A slash prints everywhere.
 */
export function portionName(fraction: Fraction, unitName: string): string {
  return `${fraction.text} ${unitName.trim()}`;
}

export type PortionResult =
  | { ok: true; name: string; factor: number }
  | { ok: false; reason: string };

/**
 * A portion of `unit`, counted in `countedIn` — or why there cannot be one.
 *
 * Refused when it does not come out whole: half of 21 rolls is 10½ rolls, and
 * stock cannot hold half a roll. The answer then is to count in something
 * smaller (sachets), which is only possible while the product is new — the
 * counted-in unit never changes once saved, so the message says which case
 * this is.
 */
export function portionOf(
  unit: { name: string; factor: number },
  fraction: Fraction,
  countedIn: string,
  options: { canChangeCountedIn: boolean; existingNames: readonly string[] },
): PortionResult {
  const exact = (unit.factor * fraction.numerator) / fraction.denominator;
  const name = portionName(fraction, unit.name);

  if (!Number.isInteger(exact) || exact < 1) {
    return {
      ok: false,
      reason:
        `${fraction.label} of a ${unit.name} is ${mixedNumber(unit.factor * fraction.numerator, fraction.denominator)} ${countedIn}s, and stock is counted in whole ${countedIn}s. ` +
        (options.canChangeCountedIn
          ? `Count this product in something smaller — rename the first unit (for example to sachet or piece) and set each unit's size in it.`
          : `This product is already counted in ${countedIn}s, which cannot change once saved, so this portion cannot be made for it.`),
    };
  }

  const taken = options.existingNames.some(
    (existing) => existing.trim().toLowerCase() === name.toLowerCase(),
  );
  if (taken) {
    return { ok: false, reason: `This product already has a "${name}".` };
  }

  return { ok: true, name, factor: exact };
}

/** 21/2 as "10 and 1/2", 1/6 as "1/6" — how a person would say it. */
function mixedNumber(numerator: number, denominator: number): string {
  const whole = Math.floor(numerator / denominator);
  const rest = numerator % denominator;
  const divisor = gcd(rest, denominator);
  const part = `${rest / divisor}/${denominator / divisor}`;
  return whole > 0 ? `${whole} and ${part}` : part;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
