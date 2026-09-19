import { ABSENT, formatMoney, type Minor } from '../lib/money';

interface MoneyProps {
  /**
   * Integer minor units, or absent.
   *
   * **`undefined` is an ordinary case here, not a bug.** The server *removes*
   * cost-bearing keys for roles that may not see them rather than nulling them
   * — `redactCost` in DECISIONS.md §9 — so `sale.lines[0].costOfGoodsSold` is
   * genuinely missing for a rep. Every component that renders money has to cope
   * with that, which is why they all go through this one.
   */
  value: Minor | null | undefined;
  currency?: string;
  /** Colour negatives red. Off by default: a negative is often expected. */
  signed?: boolean;
  className?: string;
}

/**
 * Money on screen, and the only place it should appear.
 *
 * Using this everywhere means the day the currency is not naira, or absent
 * figures should read differently, is one change rather than forty.
 */
export function Money({
  value,
  currency = 'NGN',
  signed = false,
  className = '',
}: MoneyProps) {
  const text = formatMoney(value, currency);
  const absent = text === ABSENT;
  const negative = typeof value === 'number' && value < 0;

  const tone = absent
    ? 'text-slate-400'
    : signed && negative
      ? 'text-red-600'
      : '';

  return (
    <span
      className={`tabular-nums ${tone} ${className}`.trim()}
      // Screen readers otherwise announce the em dash as punctuation or skip it.
      aria-label={absent ? 'not available' : undefined}
      title={absent ? 'Not available for your role' : undefined}
    >
      {text}
    </span>
  );
}
