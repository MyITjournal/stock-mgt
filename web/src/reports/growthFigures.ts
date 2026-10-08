import type { components } from '../api/schema';

type S = components['schemas'];
export type GrowthFigures = S['GrowthFiguresView'];
export type GrowthChange = S['GrowthChangeView'];

/**
 * The growth figures, in the order they are read (2026-10-08): what came in,
 * what was kept, then how many sales and buyers it took. One list, so Home and
 * Reports → Growth name and order them the same way.
 *
 * Every number is the server's. A percentage is basis points it worked out;
 * the margin's move is in points, because "margin up 25%" is true and useless.
 */
export interface GrowthFigure {
  key: keyof GrowthFigures;
  label: string;
  kind: 'money' | 'count' | 'percent';
  /** Where its change is read from; the margin's is in points. */
  change: (change: GrowthChange) => number | null;
  points?: boolean;
}

export const GROWTH_FIGURES: readonly GrowthFigure[] = [
  {
    key: 'revenue',
    label: 'Revenue',
    kind: 'money',
    change: (c) => c.revenue,
  },
  {
    key: 'grossProfit',
    label: 'Gross profit',
    kind: 'money',
    change: (c) => c.grossProfit,
  },
  {
    key: 'marginBps',
    label: 'Gross margin',
    kind: 'percent',
    change: (c) => c.marginPoints,
    points: true,
  },
  {
    key: 'operatingProfit',
    label: 'Operating profit',
    kind: 'money',
    change: (c) => c.operatingProfit,
  },
  {
    key: 'collected',
    label: 'Collected',
    kind: 'money',
    change: (c) => c.collected,
  },
  { key: 'sales', label: 'Sales', kind: 'count', change: (c) => c.sales },
  {
    key: 'averageSale',
    label: 'Average sale',
    kind: 'money',
    change: (c) => c.averageSale,
  },
  {
    key: 'customers',
    label: 'Customers who bought',
    kind: 'count',
    change: (c) => c.customers,
  },
  {
    key: 'newCustomers',
    label: 'New customers',
    kind: 'count',
    change: (c) => c.newCustomers,
  },
];

/** Basis points as a percentage, one decimal: 1250 → "12.5%". */
export function percent(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`;
}

/**
 * "1–8 Oct", read in the shop's own time zone — never the browser's, or a
 * Lagos shop opened from London would see its days shifted an hour.
 * `to` is exclusive, so the last day shown is the instant before it.
 */
export function dayRange(from: string, to: string, timeZone: string): string {
  const last = new Date(new Date(to).getTime() - 1);
  const day = (at: Date) =>
    at.toLocaleDateString('en-GB', { day: 'numeric', timeZone });
  const month = (at: Date) =>
    at.toLocaleDateString('en-GB', { month: 'short', timeZone });
  const start = new Date(from);
  return month(start) === month(last)
    ? `${day(start)}–${day(last)} ${month(last)}`
    : `${day(start)} ${month(start)} – ${day(last)} ${month(last)}`;
}

/** "Oct 2026" from "2026-10". */
export function monthLabel(key: string): string {
  const [year, month] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 15)).toLocaleDateString('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
