/**
 * A stock count in base units, said the way a shop says it.
 *
 * Stock is counted in the base unit (§5), which for a distributor is a
 * sachet: 2,965 is the truth and nobody can read it. "14 carton, 2 roll,
 * 5 sachet" is the same number, broken down biggest unit first.
 *
 * **Display only, and exact.** This is not a conversion anything is computed
 * from — quantities stay integers in base units everywhere else — and the base
 * unit is always the last step, so the parts always add back to the count.
 */

export interface CountUnit {
  name: string;
  factor: number;
}

export interface CountPart {
  name: string;
  count: number;
}

/**
 * A portion made by the product form — "1/2 carton", "1/6 carton". Left out of
 * the breakdown: it is a selling size, not a way of counting a shelf, and
 * "14 carton, 1 1/2 carton" says nothing a person would.
 */
const PORTION = /^\d+\/\d+\s/;

export function breakDown(
  quantity: number,
  units: readonly CountUnit[],
): CountPart[] {
  const steps = units
    .filter((unit) => unit.factor >= 1 && !PORTION.test(unit.name))
    .sort((a, b) => b.factor - a.factor);

  let left = Math.abs(quantity);
  const parts: CountPart[] = [];
  for (const unit of steps) {
    const count = Math.floor(left / unit.factor);
    if (count > 0) {
      parts.push({ name: unit.name, count });
      left -= count * unit.factor;
    }
  }
  // Only reachable if no unit has factor 1, which the server forbids — kept so
  // a malformed product shows a number rather than nothing.
  if (left > 0) parts.push({ name: '', count: left });
  return parts;
}

/** "14 carton, 2 roll, 5 sachet", "−3 piece", or "0". */
export function describeCount(
  quantity: number,
  units: readonly CountUnit[],
): string {
  if (quantity === 0) return '0';
  const text = breakDown(quantity, units)
    .map((part) => (part.name ? `${part.count} ${part.name}` : `${part.count}`))
    .join(', ');
  // A shortfall is broken down the same way and signed once, in front.
  return quantity < 0 ? `−${text}` : text;
}
