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
 * calendar days that the server still interprets in the shop's zone.
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
  if (from && to) {
    search.set('from', new Date(from).toISOString());
    // The end of the chosen day, not its midnight: a person picking
    // 1–7 September means the whole of the seventh.
    search.set('to', new Date(`${to}T23:59:59.999`).toISOString());
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
      nextFrom && nextTo
        ? setParams({ from: nextFrom, to: nextTo })
        : setParams({ period }),
  };
}

