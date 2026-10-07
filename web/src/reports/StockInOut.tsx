import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { DataTable, type Column } from '../components/DataTable';
import { Input } from '../components/Field';
import { api } from '../api/client';
import type { components } from '../api/schema';
import { describeCount } from '../lib/quantity';

type StockSummaryView = components['schemas']['StockSummaryView'];
type StockSummaryRow = components['schemas']['StockSummaryRow'];

/**
 * Stock in and out, per product, for the period picked at the top of the page
 * (2026-10-07): **opening + delivered − sold ± adjusted = total**.
 *
 * Every figure is the server's, summed from the ledger, and every movement is
 * in exactly one column, so a line always adds up. Shown in the shop's own
 * units — "6 carton, 3 piece" — with the exact count in the counted-in unit on
 * hover, as the products list does. Quantities only, so nothing to hide.
 */
export function StockInOut({ query }: { query: string }) {
  const [search, setSearch] = useState('');
  const { data, isPending } = useQuery({
    queryKey: ['reports', 'stock-summary', query],
    queryFn: () => api.get<StockSummaryView>(`/reports/stock-summary?${query}`),
  });

  const term = search.trim().toLowerCase();
  const rows = (data?.rows ?? []).filter(
    (row) =>
      !term ||
      `${row.product.name} ${row.product.size ?? ''}`
        .toLowerCase()
        .includes(term),
  );

  /** A quantity in the shop's units; blank for nothing, signed when asked. */
  const amount = (row: StockSummaryRow, quantity: number, signed = false) => {
    if (quantity === 0) return <span className="text-slate-300">—</span>;
    const base = row.units.find((unit) => unit.factor === 1)?.name ?? '';
    return (
      <span
        className={`tabular-nums ${quantity < 0 ? 'text-red-600' : ''}`}
        title={`${quantity.toLocaleString()} ${base}`}
      >
        {signed && quantity > 0 ? '+' : ''}
        {describeCount(quantity, row.units)}
      </span>
    );
  };

  const columns: readonly Column<StockSummaryRow>[] = [
    {
      header: 'Product',
      sortValue: (row) => `${row.product.name} ${row.product.size ?? ''}`,
      cell: (row) => (
        <Link
          to={`/stock/products/${row.product.id}`}
          className="text-slate-900 hover:underline"
        >
          {row.product.name}
          {row.product.size && (
            <span className="ml-1 text-slate-500">{row.product.size}</span>
          )}
        </Link>
      ),
    },
    {
      header: 'Opening',
      numeric: true,
      sortValue: (row) => row.opening,
      cell: (row) => amount(row, row.opening),
    },
    {
      header: 'Delivered',
      numeric: true,
      sortValue: (row) => row.delivered,
      cell: (row) => amount(row, row.delivered),
    },
    {
      header: 'Sold',
      numeric: true,
      sortValue: (row) => row.sold,
      cell: (row) => amount(row, row.sold),
    },
    {
      header: 'Adjusted',
      numeric: true,
      sortValue: (row) => row.adjusted,
      cell: (row) => amount(row, row.adjusted, true),
    },
    {
      header: 'Total',
      numeric: true,
      sortValue: (row) => row.closing,
      cell: (row) => (
        <span className="font-medium text-slate-900">
          {amount(row, row.closing)}
        </span>
      ),
    },
  ];

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Stock in and out
          </h2>
          <p className="text-xs text-slate-500">
            Opening + delivered − sold ± adjusted = total. Opening stock entered
            in this period counts as opening; adjusted is write-offs, counts and
            moves.
          </p>
        </div>
        <div className="w-full max-w-xs">
          <Input
            aria-label="Find a product"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Find a product"
          />
        </div>
      </div>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.product.id}
        loading={isPending}
        empty={
          term ? 'Nothing matches that.' : 'No stock moved in this period.'
        }
      />
    </section>
  );
}
