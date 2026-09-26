import { useQuery } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Money } from '../components/Money';
import { api } from '../api/client';
import type { components } from '../api/schema';
import { PeriodPicker } from './PeriodPicker';
import { usePeriodQuery } from './usePeriodQuery';

type ProfitReportView = components['schemas']['ProfitReportView'];

function percent(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`;
}

/**
 * Revenue, cost of goods, expenses and what is left.
 *
 * **Management figures, not accounting** — no accruals, no depreciation, no
 * overhead allocation (DECISIONS.md §1).
 *
 * The screen says on its face that revenue is tax-exclusive, because that is
 * the number people query. Prices are stored VAT-inclusive, so counting the
 * gross would overstate every margin by 7.5%; a figure reading lower than what
 * went through the till is this working, and an owner who is not told that will
 * assume the report is broken.
 */
export function ProfitPage() {
  const { query } = usePeriodQuery();

  const { data, isPending } = useQuery({
    queryKey: ['reports', 'profit', query],
    queryFn: () => api.get<ProfitReportView>(`/reports/profit?${query}`),
  });

  return (
    <Page
      title="Profit"
      description="What came in, what the goods cost, and what is left."
    >
      <PeriodPicker resolved={data?.period} />

      {isPending && <p className="text-sm text-slate-500">Loading…</p>}

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Headline
              label="Revenue"
              value={data.revenue}
              note="Excludes VAT and returns"
              emphasis
            />
            <Headline label="Cost of goods" value={data.cogs} />
            <Headline
              label="Gross profit"
              value={data.grossProfit}
              note={percent(data.marginBps)}
            />
            <Headline
              label="After expenses"
              value={data.operatingProfit}
              emphasis
            />
          </div>

          <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                <Line
                  label="Sold, including VAT"
                  value={data.grossSales}
                  hint="What actually went through the till"
                />
                <Line
                  label="Less VAT"
                  value={-data.tax}
                  hint="Never the business’s money"
                />
                <Line
                  label="Less returns"
                  value={-data.returned}
                  hint="Counted in the period they happened, not the month of the sale they reverse"
                />
                <Line label="Revenue" value={data.revenue} strong />
                <Line label="Less cost of goods" value={-data.cogs} />
                <Line label="Gross profit" value={data.grossProfit} strong />
                <Line label="Less expenses" value={-data.expenses} />
                <Line
                  label="Operating profit"
                  value={data.operatingProfit}
                  strong
                />
              </tbody>
            </table>
          </div>

          {data.estimatedLines > 0 && (
            <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              <strong>
                <Money value={data.estimatedCost} />
              </strong>{' '}
              of that cost is estimated, across {data.estimatedLines} line
              {data.estimatedLines === 1 ? '' : 's'}. Those goods were sold
              before the delivery they came from was recorded, so they are
              costed from the last real lot rather than at zero — the margin
              above is the best available answer, not an exact one.
            </p>
          )}

          <p className="mt-4 text-xs text-slate-500">
            Revenue is tax-exclusive and net of returns, so it reads lower than
            the till total. Expenses are what was recorded as an expense — money
            paid to a vendor for stock is not one of them, because that already
            reaches this report through cost of goods.
          </p>
        </>
      )}
    </Page>
  );
}

function Headline({
  label,
  value,
  note,
  emphasis = false,
}: {
  label: string;
  value: number | undefined;
  note?: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        emphasis
          ? 'border-slate-900 bg-slate-900 text-white'
          : 'border-slate-200 bg-white'
      }`}
    >
      <div
        className={`text-xs uppercase ${emphasis ? 'text-slate-300' : 'text-slate-500'}`}
      >
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold">
        <Money value={value} />
      </div>
      {note && (
        <div
          className={`mt-1 text-xs ${emphasis ? 'text-slate-300' : 'text-slate-500'}`}
        >
          {note}
        </div>
      )}
    </div>
  );
}

function Line({
  label,
  value,
  hint,
  strong = false,
}: {
  label: string;
  value: number;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <tr className={strong ? 'bg-slate-50' : undefined}>
      <td className="px-4 py-2.5">
        <span className={strong ? 'font-medium text-slate-900' : 'text-slate-700'}>
          {label}
        </span>
        {hint && <span className="block text-xs text-slate-400">{hint}</span>}
      </td>
      <td
        className={`px-4 py-2.5 text-right ${strong ? 'font-medium' : ''}`}
      >
        <Money value={value} signed />
      </td>
    </tr>
  );
}
