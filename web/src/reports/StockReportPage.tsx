import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Page } from '../components/Layout';
import { Money } from '../components/Money';
import { DataTable, type Column } from '../components/DataTable';
import { api } from '../api/client';
import type { components } from '../api/schema';
import { PeriodPicker } from './PeriodPicker';
import { usePeriodQuery } from './usePeriodQuery';

type StockValuationView = components['schemas']['StockValuationView'];
type StockAlertsView = components['schemas']['StockAlertsView'];
type StockAlertRow = components['schemas']['StockAlertRow'];
type ExpiryReportView = components['schemas']['ExpiryReportView'];
type StockAuditView = components['schemas']['StockAuditView'];
type ValuationGroupRow = components['schemas']['ValuationGroupRow'];

const REASON_LABELS: Record<string, string> = {
  damage: 'Damaged',
  expiry: 'Expired',
  theft: 'Missing',
  count_correction: 'After counting',
  opening_balance: 'Opening balance',
  other: 'Other',
  adjustment: 'Adjusted',
};

/**
 * What the stock is worth, what needs attention, and what somebody had to
 * decide about.
 *
 * **Valuation is from exact lot totals, rounded once** — never
 * `Product.costPrice`, which §2 forbids as an input. Each group rounds its own
 * fractions, so the parts may not add to the whole to the kobo; that is
 * correct, and the screen says so rather than letting somebody find it and
 * file a bug.
 *
 * The audit panel is the point of allowing the forced-movement override at all
 * (§5): "we sold stock we had not entered yet" becomes a list with names
 * against it, rather than a count that quietly stops adding up.
 *
 * Valuation and the audit are cost-bearing and closed to a rep; the alerts and
 * the expiry list are not, because knowing what to reorder and what to push is
 * shelf work rather than a cost question.
 */
export function StockReportPage() {
  const { query } = usePeriodQuery();

  const { data: valuation } = useQuery({
    queryKey: ['reports', 'valuation'],
    queryFn: () => api.get<StockValuationView>('/reports/stock-valuation'),
  });

  const { data: alerts } = useQuery({
    queryKey: ['reports', 'stock-alerts'],
    queryFn: () => api.get<StockAlertsView>('/reports/stock-alerts'),
  });

  const { data: expiry } = useQuery({
    queryKey: ['reports', 'expiry'],
    queryFn: () => api.get<ExpiryReportView>('/reports/expiry'),
  });

  const { data: audit } = useQuery({
    queryKey: ['reports', 'stock-audit', query],
    queryFn: () => api.get<StockAuditView>(`/reports/stock-audit?${query}`),
  });

  const valuationColumns: readonly Column<ValuationGroupRow>[] = [
    { header: 'Name', cell: (row) => row.label },
    { header: 'Units', numeric: true, cell: (row) => row.units },
    {
      header: 'Value',
      numeric: true,
      cell: (row) => <Money value={row.value} />,
    },
  ];

  const alertColumns: readonly Column<StockAlertRow>[] = [
    {
      header: 'Product',
      cell: (row) => (
        <span>
          <span className="block text-slate-900">{row.name}</span>
          <span className="block text-xs text-slate-500">{row.sku}</span>
        </span>
      ),
    },
    {
      header: 'On hand',
      numeric: true,
      cell: (row) => (
        <span
          className={`tabular-nums ${row.quantity < 0 ? 'text-red-600' : ''}`}
        >
          {row.quantity}
        </span>
      ),
    },
    {
      header: 'Reorder at',
      numeric: true,
      cell: (row) =>
        row.reorderPoint ?? <span className="text-slate-300">not set</span>,
    },
  ];

  return (
    <Page
      title="Stock"
      description="What it is worth, what is running out, and what had to be decided."
    >
      <PeriodPicker resolved={audit?.period} />

      <p className="mb-6 text-xs text-slate-500">
        Value and the audit trail cover the window above. Stock on hand, alerts
        and expiry are as of now — a level is a fact about today, not about a
        month.
      </p>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">
          What the stock is worth
        </h2>

        <div className="mb-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-900 bg-slate-900 p-4 text-white">
            <div className="text-xs uppercase text-slate-300">
              At what it cost
            </div>
            <div className="mt-1 text-2xl font-semibold">
              <Money value={valuation?.total} />
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-xs uppercase text-slate-500">Base units</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">
              {valuation?.units ?? '—'}
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="By location">
            <DataTable
              rows={valuation?.byLocation ?? []}
              columns={valuationColumns}
              rowKey={(row) => row.key}
              empty="Nothing on any shelf."
            />
          </Panel>
          <Panel title="By category">
            <DataTable
              rows={valuation?.byCategory ?? []}
              columns={valuationColumns}
              rowKey={(row) => row.key}
              empty="Nothing on any shelf."
            />
          </Panel>
        </div>

        <p className="mt-2 text-xs text-slate-500">
          Valued from the exact invoice totals of the lots on hand, rounded
          once. Each group rounds its own fractions, so the parts may not add to
          the whole to the kobo.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">
          Needs attention
        </h2>

        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title={`Out of stock (${alerts?.outOfStock.length ?? 0})`}>
            <DataTable
              rows={alerts?.outOfStock ?? []}
              columns={alertColumns}
              rowKey={(row) => row.id}
              empty="Nothing has run out."
            />
          </Panel>

          <Panel title={`Below reorder point (${alerts?.lowStock.length ?? 0})`}>
            <DataTable
              rows={alerts?.lowStock ?? []}
              columns={alertColumns}
              rowKey={(row) => row.id}
              empty="Nothing is running low."
            />
          </Panel>

          <Panel title={`Negative (${alerts?.negative.length ?? 0})`}>
            <DataTable
              rows={alerts?.negative ?? []}
              columns={alertColumns}
              rowKey={(row) => row.id}
              empty="Nothing is negative."
            />
          </Panel>
        </div>

        <p className="mt-2 text-xs text-slate-500">
          Quantities are summed across every location, because a reorder point
          is a per-product level — an empty van is not a reason to reorder when
          the store is full.
          {alerts && alerts.withoutReorderPoint > 0 && (
            <>
              {' '}
              {alerts.withoutReorderPoint} product
              {alerts.withoutReorderPoint === 1 ? ' has' : 's have'} no level
              set, so the middle list is not the whole picture.
            </>
          )}
          {alerts && alerts.negative.length > 0 && (
            <>
              {' '}
              Negative lines mean stock went out before a delivery was recorded
              — put them right with a{' '}
              <Link to="/stock/receive" className="underline">
                goods receipt
              </Link>
              , not an adjustment.
            </>
          )}
        </p>
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">
          Going off soon
        </h2>

        <Panel
          title={
            expiry
              ? `Within ${expiry.withinDays} days — ${expiry.expired} already past`
              : 'Loading…'
          }
        >
          <DataTable
            rows={expiry?.batches ?? []}
            columns={[
              { header: 'Product', cell: (row) => row.product.name },
              { header: 'Where', cell: (row) => row.location.name },
              {
                header: 'Lot',
                cell: (row) =>
                  row.lotCode ?? <span className="text-slate-300">—</span>,
              },
              {
                header: 'Expires',
                cell: (row) =>
                  row.expiryDate
                    ? new Date(row.expiryDate).toLocaleDateString()
                    : '—',
              },
              {
                header: 'Days',
                numeric: true,
                cell: (row) => (
                  <span
                    className={
                      row.daysToExpiry !== null && row.daysToExpiry < 0
                        ? 'text-red-600'
                        : ''
                    }
                  >
                    {row.daysToExpiry ?? '—'}
                  </span>
                ),
              },
              { header: 'Units', numeric: true, cell: (row) => row.quantity },
              {
                header: 'At risk',
                numeric: true,
                cell: (row) => <Money value={row.value} />,
              },
            ]}
            rowKey={(row) => row.batchId}
            empty="Nothing is going off in the next month."
          />
        </Panel>

        {expiry?.valueAtRisk !== undefined && expiry.valueAtRisk > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            <Money value={expiry.valueAtRisk} /> walks out of the door if none
            of it sells in time. Listed in the order stock is picked, so the top
            row is what goes next.
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-900">
          Decisions somebody made
        </h2>

        <div className="mb-4 flex flex-wrap gap-6 rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <div>
            <div className="text-xs uppercase text-slate-500">Movements</div>
            <div className="text-slate-900">{audit?.movements.length ?? 0}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-slate-500">
              Forced through a shortfall
            </div>
            <div className="text-slate-900">{audit?.forced ?? 0}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-slate-500">
              Net base units
            </div>
            <div className="tabular-nums text-slate-900">
              {audit?.netQuantity ?? 0}
            </div>
          </div>
          {audit?.byReason.map((row) => (
            <div key={row.reason}>
              <div className="text-xs uppercase text-slate-500">
                {REASON_LABELS[row.reason] ?? row.reason}
              </div>
              <div className="tabular-nums text-slate-900">
                {row.quantity} · {row.count}×
              </div>
            </div>
          ))}
        </div>

        <DataTable
          rows={audit?.movements ?? []}
          columns={[
            {
              header: 'When',
              cell: (row) => (
                <span className="whitespace-nowrap text-slate-600">
                  {new Date(row.createdAt).toLocaleString()}
                </span>
              ),
            },
            { header: 'Product', cell: (row) => row.product.name },
            { header: 'Where', cell: (row) => row.location.name },
            {
              header: 'Why',
              cell: (row) => (
                <span>
                  {REASON_LABELS[row.reason ?? row.type] ??
                    row.reason ??
                    row.type}
                  {row.isForced && (
                    <span
                      className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800"
                      title={row.forcedReason ?? undefined}
                    >
                      forced
                    </span>
                  )}
                  {row.forcedReason && (
                    <span className="block text-xs text-slate-500">
                      {row.forcedReason}
                    </span>
                  )}
                </span>
              ),
            },
            {
              header: 'Who',
              cell: (row) =>
                row.recordedBy
                  ? `${row.recordedBy.firstName ?? ''} ${row.recordedBy.lastName ?? ''}`.trim() ||
                    '—'
                  : '—',
            },
            {
              header: 'Quantity',
              numeric: true,
              cell: (row) => (
                <span
                  className={`tabular-nums ${
                    row.quantity < 0 ? 'text-red-600' : 'text-emerald-700'
                  }`}
                >
                  {row.quantity > 0 ? `+${row.quantity}` : row.quantity}
                </span>
              ),
            },
          ]}
          rowKey={(row) => row.id}
          empty="Nobody adjusted anything in this window."
        />
      </section>
    </Page>
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
    <div>
      <h3 className="mb-2 text-xs uppercase text-slate-500">{title}</h3>
      {children}
    </div>
  );
}
