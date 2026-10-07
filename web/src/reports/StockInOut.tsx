import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { DataTable, type Column } from '../components/DataTable';
import { Input } from '../components/Field';
import { Money } from '../components/Money';
import { api } from '../api/client';
import type { components } from '../api/schema';
import { describeCount } from '../lib/quantity';

type StockSummaryView = components['schemas']['StockSummaryView'];
type StockSummaryRow = components['schemas']['StockSummaryRow'];
type Figures = components['schemas']['StockSummaryValues'];
type Figure = keyof Figures;

/**
 * Stock in and out, per product, for the period picked at the top of the page
 * (2026-10-07): **opening + delivered − sold ± adjusted = total**.
 *
 * Every figure is the server's, summed from the ledger, and every movement is
 * in exactly one column, so a line always adds up. Quantities are in the shop's
 * own units — "6 carton, 3 piece" — with the exact count on hover.
 *
 * **In money too, for a role that may see cost** (2026-10-07, owner: "I can't
 * get the cost of opening stock before getting the total stock value"). A
 * switch shows the same table at cost, and a line above it reconciles the
 * whole shop: opening value + purchases − cost of what sold ± adjustments =
 * the stock value. The server values each movement at its own lot's exact
 * cost and rounds once; nothing is added up here.
 */
export function StockInOut({ query }: { query: string }) {
  const [search, setSearch] = useState('');
  const [inMoney, setInMoney] = useState(false);
  const { data, isPending } = useQuery({
    queryKey: ['reports', 'stock-summary', query],
    queryFn: () => api.get<StockSummaryView>(`/reports/stock-summary?${query}`),
  });
  // Only there for a role that may see cost.
  const total = data?.totalValue;
  const showMoney = inMoney && total !== undefined;

  const term = search.trim().toLowerCase();
  const rows = (data?.rows ?? []).filter(
    (row) =>
      !term ||
      `${row.product.name} ${row.product.size ?? ''}`
        .toLowerCase()
        .includes(term),
  );

  /** A quantity in the shop's units; a dash for nothing, signed when asked. */
  const count = (row: StockSummaryRow, quantity: number, signed = false) => {
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

  /** One figure, as a count or at cost depending on the switch. */
  const cell = (row: StockSummaryRow, figure: Figure, signed = false) => {
    if (!showMoney) return count(row, row[figure], signed);
    const amount = row.value?.[figure];
    if (!amount) return <span className="text-slate-300">—</span>;
    return <Money value={amount} signed={signed} />;
  };
  const sortBy = (figure: Figure) => (row: StockSummaryRow) =>
    showMoney ? row.value?.[figure] : row[figure];

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
      sortValue: sortBy('opening'),
      cell: (row) => cell(row, 'opening'),
    },
    {
      header: 'Delivered',
      numeric: true,
      sortValue: sortBy('delivered'),
      cell: (row) => cell(row, 'delivered'),
    },
    {
      header: 'Sold',
      numeric: true,
      sortValue: sortBy('sold'),
      cell: (row) => cell(row, 'sold'),
    },
    {
      header: 'Adjusted',
      numeric: true,
      sortValue: sortBy('adjusted'),
      cell: (row) => cell(row, 'adjusted', true),
    },
    {
      header: 'Total',
      numeric: true,
      sortValue: sortBy('closing'),
      cell: (row) => (
        <span className="font-medium text-slate-900">
          {cell(row, 'closing')}
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
        <div className="flex flex-wrap items-center gap-3">
          {total !== undefined && (
            <div
              className="inline-flex rounded-md border border-slate-300 p-0.5 text-sm"
              role="group"
              aria-label="Show as"
            >
              {(
                [
                  ['Quantities', false],
                  ['Value', true],
                ] as const
              ).map(([label, money]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setInMoney(money)}
                  aria-pressed={inMoney === money}
                  className={`rounded px-3 py-1 ${
                    inMoney === money
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <Input
            aria-label="Find a product"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Find a product"
            className="w-56"
          />
        </div>
      </div>

      {showMoney && (
        // The whole shop, at cost: the line to check the books against.
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <Part label="Opening stock" value={total.opening} />
          <span className="text-slate-400">+</span>
          <Part label="Delivered" value={total.delivered} />
          <span className="text-slate-400">−</span>
          <Part label="Sold, at cost" value={total.sold} />
          <span className="text-slate-400">±</span>
          <Part label="Adjusted" value={total.adjusted} signed />
          <span className="text-slate-400">=</span>
          <Part label="Stock value" value={total.closing} strong />
        </div>
      )}

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.product.id}
        loading={isPending}
        empty={
          term ? 'Nothing matches that.' : 'No stock moved in this period.'
        }
      />
      {showMoney && (
        <p className="mt-2 text-xs text-slate-500">
          At each lot’s cost today. If a delivery or an opening cost was
          corrected after goods sold, “Sold, at cost” here and the cost on the
          profit report differ by that correction.
        </p>
      )}
    </section>
  );
}

function Part({
  label,
  value,
  signed = false,
  strong = false,
}: {
  label: string;
  value: number;
  signed?: boolean;
  strong?: boolean;
}) {
  return (
    <span>
      <span className="block text-xs uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <span
        className={strong ? 'font-semibold text-slate-900' : 'text-slate-900'}
      >
        <Money value={value} signed={signed} />
      </span>
    </span>
  );
}
