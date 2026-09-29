import type { components } from '../api/schema';
import { usePeriodQuery } from './usePeriodQuery';

type PeriodView = components['schemas']['PeriodView'];

/** The windows the server knows how to resolve, in the order people ask for them. */
const NAMED = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last-7-days', label: 'Last 7 days' },
  { value: 'month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'last-30-days', label: 'Last 30 days' },
  { value: 'year', label: 'This year' },
] as const;

export function PeriodPicker({ resolved }: { resolved?: PeriodView }) {
  const { period, from, to, setPeriod, setRange } = usePeriodQuery();
  const custom = Boolean(from && to);

  return (
    <div className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap gap-1">
        {NAMED.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setPeriod(option.value)}
            className={`rounded-md px-3 py-1.5 text-sm transition ${
              !custom && period === option.value
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 border-l border-slate-200 pl-3">
        <input
          type="date"
          value={from}
          aria-label="From"
          onChange={(event) => setRange(event.target.value, to)}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
        <span className="text-sm text-slate-400">to</span>
        <input
          type="date"
          value={to}
          aria-label="To"
          onChange={(event) => setRange(from, event.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
      </div>

      {resolved && (
        <p className="ml-auto text-xs text-slate-500">
          {/* The server's own answer, not ours: it resolved these boundaries
              in the shop's timezone and we only report what came back. */}
          {new Date(resolved.from).toLocaleDateString()} –{' '}
          {new Date(
            new Date(resolved.to).getTime() - 1,
          ).toLocaleDateString()}{' '}
          · {resolved.timezone}
        </p>
      )}
    </div>
  );
}
