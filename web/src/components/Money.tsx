import { ABSENT, formatMoney, type Minor } from '../lib/money';
import { useShopCurrency } from '../lib/shopCurrency';

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
  /** Omitted — the usual case — it is the shop's own (`useShopCurrency`). */
  currency?: string;
  /** Colour negatives red. Off by default: a negative is often expected. */
  signed?: boolean;
  className?: string;
}

/**
 * Money on screen, and the only place it should appear.
 *
 * Using this everywhere is what made a shop in cedis one change rather than
 * forty (2026-10-06): the currency comes from the shop, not the call site.
 */
export function Money({
  value,
  currency,
  signed = false,
  className = '',
}: MoneyProps) {
  const shopCurrency = useShopCurrency();
  const text = formatMoney(value, currency ?? shopCurrency);
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
