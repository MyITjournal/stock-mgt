import { Link } from 'react-router-dom';
import type { components } from '../api/schema';
import { Money } from '../components/Money';
import { ChangeBadge } from '../components/ChangeBadge';
import {
  dayRange,
  GROWTH_FIGURES,
  percent,
  type GrowthFigure,
  type GrowthFigures,
} from '../reports/growthFigures';

type Comparison = components['schemas']['GrowthComparisonView'];

/**
 * Is the business growing (2026-10-08, owner: "a proper assessment of the
 * business in comparison to previous months").
 *
 * This month so far against **the same days of last month** — 1–8 October
 * against 1–8 September, to the same time of day — never against the whole of
 * last month, which made every month look like a collapse until its last week.
 * Every figure and change is the server's; month by month is on Reports →
 * Growth.
 */
export function GrowthPanel({
  growth,
  timezone,
}: {
  growth: Comparison;
  timezone: string;
}) {
  const now = dayRange(growth.currentFrom, growth.currentTo, timezone);
  const then = dayRange(growth.previousFrom, growth.previousTo, timezone);

  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">
          Growth: this month so far, against the same days last month
        </h2>
        <Link
          to="/reports/growth"
          className="text-sm font-medium text-slate-900 underline-offset-2 hover:underline"
        >
          Month by month
        </Link>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium" />
              <th className="px-4 py-2 text-right font-medium">{now}</th>
              <th className="px-4 py-2 text-right font-medium">{then}</th>
              <th className="px-4 py-2 text-right font-medium">Change</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {GROWTH_FIGURES.map((figure) => (
              <tr key={figure.key}>
                <td className="px-4 py-2 text-slate-700">{figure.label}</td>
                <td className="px-4 py-2 text-right font-medium text-slate-900">
                  <Figure figure={figure} figures={growth.current} />
                </td>
                <td className="px-4 py-2 text-right text-slate-600">
                  <Figure figure={figure} figures={growth.previous} />
                </td>
                <td className="px-4 py-2 text-right">
                  <ChangeBadge
                    bps={figure.change(growth.change)}
                    points={figure.points}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** One figure in its own form: money, a count, or a percentage. */
export function Figure({
  figure,
  figures,
}: {
  figure: GrowthFigure;
  figures: GrowthFigures;
}) {
  const value = figures[figure.key];
  if (figure.kind === 'money') return <Money value={value} />;
  if (figure.kind === 'percent') return <>{percent(value)}</>;
  return <>{value.toLocaleString('en-NG')}</>;
}
