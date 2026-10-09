import { describeCount, type CountUnit } from '../lib/quantity';

/**
 * A stock count said in the shop's units — "14 carton, 5 piece" — with the
 * exact count in the smallest unit on hover (2026-10-09). The same reading the
 * Products list and "Stock in and out" give, for every row that counts one
 * product. Display only: sort and compute on the number, never on this.
 */
export function Count({
  quantity,
  units,
  signed = false,
  className = '',
}: {
  /** In base units. */
  quantity: number;
  units: readonly CountUnit[];
  /** Puts a + on a gain, for a list of changes. */
  signed?: boolean;
  className?: string;
}) {
  const base = units.find((unit) => unit.factor === 1)?.name ?? '';
  return (
    <span
      className={`tabular-nums ${quantity < 0 ? 'text-red-600' : ''} ${className}`}
      title={`${quantity.toLocaleString()} ${base}`.trim()}
    >
      {signed && quantity > 0 ? '+' : ''}
      {describeCount(quantity, units)}
    </span>
  );
}
