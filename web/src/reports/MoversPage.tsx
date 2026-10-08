import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Page } from '../components/Layout';
import { Money } from '../components/Money';
import { DataTable, type Column } from '../components/DataTable';
import { api } from '../api/client';
import type { components } from '../api/schema';
import { optionLabel } from '../lib/options';
import { PeriodPicker } from './PeriodPicker';
import { usePeriodQuery } from './usePeriodQuery';
import { DownloadButton } from '../components/DownloadButton';
import { exportMovers } from './exportReports';

type ProductReportView = components['schemas']['ProductReportView'];
type CustomerReportView = components['schemas']['CustomerReportView'];
type SalesGroupRow = components['schemas']['SalesGroupRow'];
type CustomerReportRow = components['schemas']['CustomerReportRow'];

function margin(bps: number | undefined): string {
  return bps === undefined ? '—' : `${(bps / 100).toFixed(1)}%`;
}

function name(row: CustomerReportRow['customer']): string {
  return `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim() || 'Unnamed';
}

/**
 * What is moving, what is not, and who is buying it.
 *
 * **Top by revenue and top by units are both here because they disagree**, and
 * the disagreement is where the high-volume thin-margin lines are: a product
 * that tops the units list and is missing from the revenue list is a lot of
 * work for very little (DECISIONS.md §6).
 *
 * Dead stock is cash sitting on a shelf — held, but nothing sold in the stale
 * window. The lapsed customer list is the other half of the same idea: people
 * who used to buy and have stopped, which is a phone call rather than a report.
 */
export function MoversPage() {
  const { query } = usePeriodQuery();

  const { data: products } = useQuery({
    queryKey: ['reports', 'products', query],
    queryFn: () => api.get<ProductReportView>(`/reports/products?${query}`),
  });

  const { data: customers } = useQuery({
    queryKey: ['reports', 'customers', query],
    queryFn: () => api.get<CustomerReportView>(`/reports/customers?${query}`),
  });

  const productColumns: readonly Column<SalesGroupRow>[] = [
    {
      header: 'Product',
      sortValue: (row) => row.label,
      cell: (row) => row.label,
    },
    {
      header: 'Revenue',
      sortValue: (row) => row.revenue,
      numeric: true,
      cell: (row) => <Money value={row.revenue} />,
    },
    {
      header: 'Units',
      sortValue: (row) => row.units,
      numeric: true,
      cell: (row) => row.units,
    },
    {
      header: 'Margin',
      sortValue: (row) => row.marginBps,
      numeric: true,
      cell: (row) => margin(row.marginBps),
    },
  ];

  const customerColumns: readonly Column<CustomerReportRow>[] = [
    {
      header: 'Customer',
      sortValue: (row) => name(row.customer),
      cell: (row) => (
        <Link
          to={`/customers/${row.customer.id}`}
          className="text-slate-900 hover:underline"
        >
          {name(row.customer)}
          {row.customer.phone && (
            <span className="block text-xs text-slate-500">
              {row.customer.phone}
            </span>
          )}
        </Link>
      ),
    },
    {
      header: 'Spend',
      sortValue: (row) => row.spend,
      numeric: true,
      cell: (row) => <Money value={row.spend} />,
    },
    {
      header: 'Invoices',
      sortValue: (row) => row.invoices,
      numeric: true,
      cell: (row) => row.invoices,
    },
    {
      header: 'Margin',
      sortValue: (row) => row.marginBps,
      numeric: true,
      cell: (row) => margin(row.marginBps),
    },
    {
      header: 'Still owes',
      sortValue: (row) => row.balance,
      numeric: true,
      cell: (row) =>
        row.balance === 0 ? (
          <span className="text-slate-300">—</span>
        ) : (
          <Money value={row.balance} />
        ),
    },
    {
      header: 'Last bought',
      sortValue: (row) => row.lastPurchase,
      cell: (row) =>
        row.lastPurchase
          ? new Date(row.lastPurchase).toLocaleDateString()
          : 'never',
    },
  ];

  return (
    <Page
      title="Movers"
      description="What sells, what sits, and who is buying."
      actions={
        <DownloadButton
          disabled={!products}
          onDownload={() => exportMovers(products!, customers)}
        />
      }
    >
      <PeriodPicker resolved={products?.period} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Best by revenue">
          <DataTable
            rows={products?.topByRevenue ?? []}
            columns={productColumns}
            rowKey={(row) => row.key}
            empty="Nothing sold in this window."
          />
        </Section>

        <Section
          title="Best by units"
          note="Compare with the list beside it — a product high here and absent there is a lot of work for very little."
        >
          <DataTable
            rows={products?.topByUnits ?? []}
            columns={productColumns}
            rowKey={(row) => row.key}
            empty="Nothing sold in this window."
          />
        </Section>

        <Section title="Thinnest margins">
          <DataTable
            rows={products?.byMargin ?? []}
            columns={productColumns}
            rowKey={(row) => row.key}
            empty="Nothing sold in this window."
          />
        </Section>

        <Section
          title={`Not moving${products ? ` — nothing sold in ${products.staleDays} days` : ''}`}
          note="Cash sitting on a shelf."
        >
          <DataTable
            rows={products?.deadStock ?? []}
            columns={[
              {
                header: 'Product',
                cell: (row) =>
                  optionLabel(
                    row.product.name ?? row.product.id.slice(0, 8),
                    row.variant?.name,
                  ),
              },
              {
                header: 'SKU',
                cell: (row) =>
                  row.product.sku ?? <span className="text-slate-300">—</span>,
              },
              {
                header: 'Units held',
                numeric: true,
                cell: (row) => row.quantity,
              },
            ]}
            rowKey={(row) => `${row.product.id}:${row.variant?.id ?? ''}`}
            empty="Everything held has sold recently."
          />
        </Section>
      </div>

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Who buys</h2>
        <DataTable
          rows={customers?.customers ?? []}
          columns={customerColumns}
          rowKey={(row) => row.customer.id}
          empty="Nobody bought anything in this window."
        />
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">
          Stopped buying
        </h2>
        <p className="mb-2 text-xs text-slate-500">
          Bought before, but not in this window. Most recently seen first —
          these are the calls to make.
        </p>
        <DataTable
          rows={customers?.lapsed ?? []}
          columns={customerColumns}
          rowKey={(row) => row.customer.id}
          empty="Everybody who has ever bought, bought in this window."
        />
      </section>
    </Page>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold text-slate-900">{title}</h2>
      {note && <p className="mb-2 text-xs text-slate-500">{note}</p>}
      {children}
    </section>
  );
}
