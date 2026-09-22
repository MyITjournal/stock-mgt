import { useQuery } from '@tanstack/react-query';
import { api, type ApiResponse } from '../api/client';
import { Money } from '../components/Money';
import { Page } from '../components/Layout';
import { DataTable } from '../components/DataTable';
import { Spinner } from '../auth/RequireAuth';

/**
 * The whole screen, from one request.
 *
 * `GET /reports/dashboard` is deliberately a single call rather than nine — a
 * phone on a Nigerian mobile connection pays a round trip for each one, and a
 * home screen that fires nine feels broken long before it is slow. The panels
 * below are sections of one response, not nine queries.
 *
 * The type comes from the generated schema, so a field that changes shape on
 * the server breaks this build rather than rendering blank.
 */
type Dashboard = ApiResponse<'/api/v1/reports/dashboard'>;

export function HomePage() {
  const { data, isPending, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<Dashboard>('/reports/dashboard'),
  });

  if (isPending) {
    return (
      <div className="flex justify-center py-24">
        <Spinner label="Loading your morning" />
      </div>
    );
  }

  if (error) {
    return (
      <Page title="Home">
        <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          {error.message}
        </p>
      </Page>
    );
  }

  const { sales, collections, receivables, profit, attention, movers, purchasing } =
    data;

  return (
    <Page
      title="Home"
      description={`This month, in ${data.timezone}. Generated ${new Date(
        data.generatedAt,
      ).toLocaleTimeString()}.`}
    >
      {/*
        Sales and collections sit next to each other on purpose. On a credit
        route they diverge constantly, and a business reading only the first
        can have a good month while running out of cash.
      */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Sold today"
          value={<Money value={sales.today} />}
          note="Tax-exclusive"
        />
        <Stat
          label="Collected today"
          value={<Money value={collections.today} />}
          note="Money actually received"
        />
        <Stat
          label="Sold this month"
          value={<Money value={sales.month} />}
          note={<Change bps={sales.changeBps} />}
        />
        <Stat
          label="Uncollected this month"
          value={<Money value={collections.uncollectedThisMonth} />}
          note="Sold but not yet paid for"
          tone={collections.uncollectedThisMonth > 0 ? 'warn' : undefined}
        />
      </section>

      <section className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Owed to me"
          value={<Money value={receivables.total} />}
          note={`${receivables.invoices} invoice${
            receivables.invoices === 1 ? '' : 's'
          }, oldest ${receivables.oldestDays}d`}
        />
        <Stat
          label="I owe vendors"
          value={<Money value={purchasing.payables.total} />}
          note={`${purchasing.payables.bills} bill${
            purchasing.payables.bills === 1 ? '' : 's'
          } across ${purchasing.payables.suppliers}`}
          tone={purchasing.payables.overdue > 0 ? 'warn' : undefined}
        />
        <Stat
          label="Gross profit"
          value={<Money value={profit.grossProfit} />}
          note={`${(profit.marginBps / 100).toFixed(1)}% margin`}
        />
        <Stat
          label="Operating profit"
          value={<Money value={profit.operatingProfit} />}
          note={
            <>
              after <Money value={profit.expenses} /> expenses
            </>
          }
          tone={profit.operatingProfit < 0 ? 'bad' : undefined}
        />
      </section>

      {profit.estimatedLines > 0 && (
        <p className="mt-4 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Money value={profit.estimatedCost} /> of this month&rsquo;s cost is
          estimated, across {profit.estimatedLines} line
          {profit.estimatedLines === 1 ? '' : 's'} — goods sold before their
          delivery was recorded, costed from the last real lot. The margin above
          is the best available answer, not a measured one.
        </p>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Panel title="Who owes me most">
          <DataTable
            rows={receivables.topDebtors}
            rowKey={(row, i) => row.customer?.id ?? `walk-in-${i}`}
            columns={[
              {
                header: 'Customer',
                cell: (row) =>
                  row.customer
                    ? `${row.customer.firstName} ${row.customer.lastName ?? ''}`.trim()
                    : 'Walk-in',
              },
              { header: 'Invoices', cell: (row) => row.invoices, numeric: true },
              { header: 'Oldest', cell: (row) => `${row.oldestDays}d`, numeric: true },
              {
                header: 'Balance',
                cell: (row) => <Money value={row.balance} />,
                numeric: true,
              },
            ]}
            empty="Nobody owes anything."
          />
        </Panel>

        <Panel title="Who I owe most">
          <DataTable
            rows={purchasing.payables.topVendors}
            rowKey={(row) => row.supplier.id}
            columns={[
              { header: 'Vendor', cell: (row) => row.supplier.name },
              { header: 'Bills', cell: (row) => row.bills, numeric: true },
              { header: 'Oldest', cell: (row) => `${row.oldestDays}d`, numeric: true },
              {
                header: 'Balance',
                cell: (row) => <Money value={row.balance} />,
                numeric: true,
              },
            ]}
            empty="You owe nothing."
          />
        </Panel>

        <Panel title="Best sellers this month">
          <DataTable
            rows={movers.topByRevenue}
            rowKey={(row) => row.key}
            columns={[
              { header: 'Product', cell: (row) => row.label },
              { header: 'Units', cell: (row) => row.units, numeric: true },
              {
                header: 'Revenue',
                cell: (row) => <Money value={row.revenue} />,
                numeric: true,
              },
              {
                header: 'Margin',
                cell: (row) => `${(row.marginBps / 100).toFixed(1)}%`,
                numeric: true,
              },
            ]}
            empty="Nothing sold this month yet."
          />
        </Panel>

        <Panel title="Bought this month">
          <DataTable
            rows={purchasing.purchases.topVendors}
            rowKey={(row) => row.key}
            columns={[
              { header: 'Vendor', cell: (row) => row.label },
              {
                header: 'Deliveries',
                cell: (row) => row.lines,
                numeric: true,
              },
              {
                header: 'Value',
                cell: (row) => <Money value={row.value} />,
                numeric: true,
              },
            ]}
            empty="No deliveries recorded this month."
          />
        </Panel>
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">
          What needs attention
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Stat
            label="Out of stock"
            value={attention.outOfStockCount}
            tone={attention.outOfStockCount > 0 ? 'warn' : undefined}
          />
          <Stat
            label="Low stock"
            value={attention.lowStockCount}
            tone={attention.lowStockCount > 0 ? 'warn' : undefined}
          />
          <Stat
            label="Expiring in 30 days"
            value={attention.expiringCount}
            note={
              // Withheld from roles that may not see cost — but this endpoint
              // is closed to them anyway, so it is always present here.
              <>
                <Money value={attention.valueAtRisk} /> at risk
              </>
            }
            tone={attention.expired > 0 ? 'bad' : undefined}
          />
          <Stat
            label="Negative stock"
            value={attention.negativeStock.length}
            tone={attention.negativeStock.length > 0 ? 'bad' : undefined}
          />
          <Stat
            label="Forced movements"
            value={attention.forcedMovements}
            note="Pushed through a shortfall"
            tone={attention.forcedMovements > 0 ? 'warn' : undefined}
          />
        </div>
      </section>
    </Page>
  );
}

function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
  tone?: 'warn' | 'bad';
}) {
  const ring =
    tone === 'bad'
      ? 'border-red-200 bg-red-50'
      : tone === 'warn'
        ? 'border-amber-200 bg-amber-50'
        : 'border-slate-200 bg-white';

  return (
    <div className={`rounded-lg border p-4 ${ring}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

/** Month on month, in basis points. Zero means last month sold nothing. */
function Change({ bps }: { bps: number }) {
  if (bps === 0) return <>No comparison for last month</>;
  const up = bps > 0;
  return (
    <span className={up ? 'text-green-700' : 'text-red-600'}>
      {up ? '▲' : '▼'} {Math.abs(bps / 100).toFixed(1)}% on last month
    </span>
  );
}
