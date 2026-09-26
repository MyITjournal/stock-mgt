import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Money } from '../components/Money';
import { DataTable, type Column } from '../components/DataTable';
import { api } from '../api/client';
import { useSeesCost } from '../auth/useAuth';
import type { components } from '../api/schema';
import { PeriodPicker } from './PeriodPicker';
import { usePeriodQuery } from './usePeriodQuery';

type SalesReportView = components['schemas']['SalesReportView'];
type SalesGroupRow = components['schemas']['SalesGroupRow'];

const GROUPINGS = [
  { value: 'day', label: 'By day' },
  { value: 'product', label: 'By product' },
  { value: 'category', label: 'By category' },
  { value: 'customer', label: 'By customer' },
  { value: 'location', label: 'By location' },
  { value: 'rep', label: 'By rep' },
  { value: 'tier', label: 'By tier' },
];

/**
 * What sold, sliced seven ways.
 *
 * **The only report open to a rep**, because what sold and to whom is the one
 * slice they need. The margin columns — cost, gross profit, margin — are
 * removed for them from the rows *and* the totals: 7.2 shipped a leak of
 * exactly that shape on `GET /sales`, where the lines were redacted one by one
 * and the header total, being the same numbers summed, went straight out
 * (DECISIONS.md §9).
 *
 * Grouping by product or category works at line level; everything else works at
 * sale level — a sale spanning three products belongs to three product groups
 * and exactly one customer.
 */
export function SalesReportPage() {
  const { query } = usePeriodQuery();
  const [params, setParams] = useSearchParams();
  const seesCost = useSeesCost();

  const groupBy = params.get('groupBy') ?? 'day';

  const { data, isPending } = useQuery({
    queryKey: ['reports', 'sales', query, groupBy],
    queryFn: () =>
      api.get<SalesReportView>(`/reports/sales?${query}&groupBy=${groupBy}`),
  });

  const setGrouping = (value: string) => {
    const next = new URLSearchParams(params);
    next.set('groupBy', value);
    setParams(next);
  };

  const columns: readonly Column<SalesGroupRow>[] = [
    { header: label(groupBy), cell: (row) => row.label },
    {
      header: 'Revenue',
      numeric: true,
      cell: (row) => <Money value={row.revenue} />,
    },
    {
      header: 'Returned',
      numeric: true,
      cell: (row) =>
        row.returned === 0 ? (
          <span className="text-slate-300">—</span>
        ) : (
          <Money value={row.returned} />
        ),
    },
    { header: 'Units', numeric: true, cell: (row) => row.units },
    { header: 'Invoices', numeric: true, cell: (row) => row.invoices },
    ...(seesCost
      ? [
          {
            header: 'Cost',
            numeric: true,
            cell: (row: SalesGroupRow) => <Money value={row.cogs} />,
          },
          {
            header: 'Gross profit',
            numeric: true,
            cell: (row: SalesGroupRow) => <Money value={row.grossProfit} />,
          },
          {
            header: 'Margin',
            numeric: true,
            cell: (row: SalesGroupRow) =>
              row.marginBps === undefined ? (
                <span className="text-slate-300">—</span>
              ) : (
                `${(row.marginBps / 100).toFixed(1)}%`
              ),
          },
        ]
      : []),
  ];

  return (
    <Page title="Sales" description="What sold, and to whom.">
      <PeriodPicker resolved={data?.period} />

      <div className="mb-4 flex flex-wrap gap-1">
        {GROUPINGS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setGrouping(option.value)}
            className={`rounded-md px-3 py-1.5 text-sm transition ${
              groupBy === option.value
                ? 'bg-slate-100 font-medium text-slate-900'
                : 'text-slate-500 hover:bg-slate-50'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {data && (
        <div className="mb-4 flex flex-wrap gap-6 rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <Total label="Revenue" value={data.totals.revenue} />
          <Total label="Sold, with VAT" value={data.totals.grossSales} />
          <Total label="Returned" value={data.totals.returned} />
          {seesCost && (
            <>
              <Total label="Cost of goods" value={data.totals.cogs} />
              <Total label="Gross profit" value={data.totals.grossProfit} />
            </>
          )}
          <div>
            <div className="text-xs uppercase text-slate-500">Invoices</div>
            <div className="text-slate-900">{data.totals.invoices}</div>
          </div>
        </div>
      )}

      <DataTable
        rows={data?.rows ?? []}
        columns={columns}
        rowKey={(row) => row.key}
        loading={isPending}
        empty="Nothing sold in this window."
      />

      <p className="mt-4 text-xs text-slate-500">
        Revenue is tax-exclusive and net of returns, and a return counts in the
        period it happened rather than the month of the sale it reverses.
      </p>
    </Page>
  );
}

function label(groupBy: string): string {
  const found = GROUPINGS.find((option) => option.value === groupBy);
  return found ? found.label.replace('By ', '') : groupBy;
}

function Total({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div>
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className="text-slate-900">
        <Money value={value} />
      </div>
    </div>
  );
}
