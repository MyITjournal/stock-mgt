import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Page } from '../components/Layout';
import { Money } from '../components/Money';
import { ChangeBadge } from '../components/ChangeBadge';
import { DataTable, type Column } from '../components/DataTable';
import { DownloadButton } from '../components/DownloadButton';
import { Field, Select } from '../components/Field';
import { api } from '../api/client';
import type { components } from '../api/schema';
import { MonthBars } from './MonthBars';
import { GROWTH_FIGURES, monthLabel, percent } from './growthFigures';
import { exportGrowth } from './exportReports';

type GrowthReport = components['schemas']['GrowthReportView'];
type GrowthMonth = components['schemas']['GrowthMonthView'];

/**
 * Month by month: is the business growing (2026-10-08)?
 *
 * Each month against the one before it. **This month is partial**, so it is
 * set against the same days of last month, never the whole of it — the same
 * comparison Home makes. Six or twelve months, kept in the address so a link
 * says which. Every figure and change is the server's (`GET /reports/growth`).
 */
export function GrowthPage() {
  const [params, setParams] = useSearchParams();
  const months = params.get('months') === '12' ? 12 : 6;

  const { data, isPending, error } = useQuery({
    queryKey: ['growth', months],
    queryFn: () => api.get<GrowthReport>(`/reports/growth?months=${months}`),
  });

  const rows = data?.months ?? [];
  const bars = (pick: (month: GrowthMonth) => number) =>
    rows.map((month) => ({
      key: month.month,
      label: monthLabel(month.month),
      value: pick(month),
      partial: month.partial,
    }));

  return (
    <Page
      title="Growth"
      description="Each month against the one before. This month is so far, against the same days of last month."
      actions={
        <DownloadButton
          disabled={!data}
          onDownload={() => exportGrowth(data!)}
        />
      }
    >
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <Field label="Show" htmlFor="growth-months">
          <Select
            id="growth-months"
            value={String(months)}
            onChange={(event) =>
              setParams(
                (current) => {
                  current.set('months', event.target.value);
                  return current;
                },
                { replace: true },
              )
            }
            className="w-40"
          >
            <option value="6">Last 6 months</option>
            <option value="12">Last 12 months</option>
          </Select>
        </Field>
      </div>

      {error && (
        <p className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          {error.message}
        </p>
      )}
      {isPending && <p className="text-sm text-slate-500">Loading…</p>}

      {data && (
        <>
          <div className="mb-6 grid gap-4 lg:grid-cols-2">
            <MonthBars
              title="Revenue by month"
              bars={bars((month) => month.figures.revenue)}
            />
            <MonthBars
              title="Gross profit by month"
              bars={bars((month) => month.figures.grossProfit)}
            />
          </div>

          {/* The table is the chart's figures in full, newest first. */}
          <DataTable
            rows={[...rows].reverse()}
            rowKey={(row) => row.month}
            columns={columns}
            empty="Nothing recorded in these months."
          />
        </>
      )}
    </Page>
  );
}

/** A figure with its change beneath it. */
function withChange(
  figure: (typeof GROWTH_FIGURES)[number],
): Column<GrowthMonth> {
  return {
    header: figure.label,
    numeric: true,
    cell: (row) => {
      const value = row.figures[figure.key];
      return (
        <span className="block">
          <span className="block font-medium text-slate-900">
            {figure.kind === 'money' ? (
              <Money value={value} />
            ) : figure.kind === 'percent' ? (
              percent(value)
            ) : (
              value.toLocaleString('en-NG')
            )}
          </span>
          <span className="block text-xs">
            <ChangeBadge
              bps={figure.change(row.change)}
              points={figure.points}
            />
          </span>
        </span>
      );
    },
  };
}

const columns: Column<GrowthMonth>[] = [
  {
    header: 'Month',
    cell: (row) => (
      <span>
        {monthLabel(row.month)}
        {row.partial && (
          <span className="block text-xs text-slate-500">
            so far, against the same days
          </span>
        )}
      </span>
    ),
  },
  ...GROWTH_FIGURES.map(withChange),
];
