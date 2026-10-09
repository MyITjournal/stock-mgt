import { useSearchParams } from 'react-router-dom';

/**
 * The window every report is read over.
 *
 * **The browser never works out a date range.** It sends the period *name* and
 * the server resolves it in `Organization.timezone` (DECISIONS.md §6) — the
 * reason being that a shop in Lagos on a laptop set to UTC would otherwise see
 * "today" roll over at 1am, and every daily figure would be wrong for an hour
 * in a way nobody would think to check. The resolved window comes back on the
 * response, which is what the screens label themselves with.
 *
 * A custom range is the one case the browser sends dates, and they are plain
 * calendar days (`2026-10-07`) that the server reads as whole days in the
 * shop's zone (`customPeriod`) — no time of day is worked out here.
 *
 * The two dates are picked one at a time, so a half-picked range is kept in
 * the URL (2026-10-09: it used to be thrown away, and the box the person had
 * just filled went blank). The report stays on the named period until both
 * are in, and the right way round.
 *
 * Kept in the URL rather than in component state, so switching tabs keeps the
 * window and a link to "last month's profit" is a link somebody can send.
 */
export function usePeriodQuery(): {
  query: string;
  period: string;
  from: string;
  to: string;
  setPeriod: (name: string) => void;
  setRange: (from: string, to: string) => void;
} {
  const [params, setParams] = useSearchParams();

  const period = params.get('period') ?? 'month';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';

  const search = new URLSearchParams();
  // `YYYY-MM-DD` compares as text in date order.
  if (from && to && from <= to) {
    search.set('from', from);
    // Inclusive: the server takes the whole of the last day named.
    search.set('to', to);
  } else {
    search.set('period', period);
  }

  return {
    query: search.toString(),
    period,
    from,
    to,
    setPeriod: (name) => setParams({ period: name }),
    setRange: (nextFrom, nextTo) =>
      setParams({
        period,
        ...(nextFrom && { from: nextFrom }),
        ...(nextTo && { to: nextTo }),
      }),
  };
}

