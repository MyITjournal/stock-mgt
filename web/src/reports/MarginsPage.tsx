import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Page } from '../components/Layout';
import { Money } from '../components/Money';
import { DataTable, type Column } from '../components/DataTable';
import { Field, Select } from '../components/Field';
import { DownloadButton } from '../components/DownloadButton';
import { api } from '../api/client';
import type { components } from '../api/schema';
import { exportMargins } from './exportReports';

type MarginsView = components['schemas']['MarginsView'];
type MarginRow = components['schemas']['MarginRow'];
type CategoryView = { id: string; name: string };
type PriceTierView = { id: string; name: string; isDefault: boolean };

function percent(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`;
}

/**
 * Today's price beside what the stock cost, per selling unit (2026-10-07).
 *
 * For deciding prices — the owner's case was a promo moving from "buy 19 get
 * 1 free" to "buy 12 get 1 free", which makes every piece cheaper. **A
 * projection, not a record**: nothing here changes what the profit report says
 * about what was actually sold.
 *
 * The cost is the **average of the stock on hand**, from lot totals (§2), so a
 * new deal moves it as the new stock arrives and the old sells through. The
 * last delivery sits beside it, with its deal spelled out ("13 for 12"), so a
 * change shows at once even while the average catches up. Every figure is the
 * server's — the screen computes nothing (§17). The margin is on the price
 * without VAT, as profit is.
 *
 * Thinnest margin first, because the rows worth acting on are at the top.
 */
export function MarginsPage() {
  const [tierId, setTierId] = useState('');
  const [categoryId, setCategoryId] = useState('');

  const query = new URLSearchParams();
  if (tierId) query.set('tierId', tierId);
  if (categoryId) query.set('categoryId', categoryId);

  const { data, isPending } = useQuery({
    queryKey: ['reports', 'margins', query.toString()],
    queryFn: () => api.get<MarginsView>(`/reports/margins?${query}`),
  });
  const { data: tiers = [] } = useQuery({
    queryKey: ['price-tiers'],
    queryFn: () => api.get<PriceTierView[]>('/price-tiers'),
  });
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<CategoryView[]>('/categories'),
  });

  const columns: readonly Column<MarginRow>[] = [
    {
      header: 'Product',
      sortValue: (row) => `${row.productName} ${row.size ?? ''}`,
      cell: (row) => (
        <Link
          to={`/stock/products/${row.productId}`}
          className="text-slate-900 hover:underline"
        >
          {row.productName}
          {row.size && <span className="ml-1 text-slate-500">{row.size}</span>}
        </Link>
      ),
    },
    {
      header: 'Unit',
      sortValue: (row) => row.unitName,
      cell: (row) => row.unitName,
    },
    {
      header: 'Price',
      sortValue: (row) => row.price,
      numeric: true,
      cell: (row) =>
        row.price === null ? (
          <span className="text-xs text-slate-400">no price</span>
        ) : (
          <Money value={row.price} />
        ),
    },
    {
      header: 'Cost',
      sortValue: (row) => row.cost,
      numeric: true,
      cell: (row) =>
        row.cost === null ? (
          <span className="text-xs text-slate-400">no cost yet</span>
        ) : (
          <span>
            <Money value={row.cost} />
            {row.costFrom === 'last_delivery' && (
              <span className="block text-xs text-slate-500">
                none on hand — last delivery
              </span>
            )}
          </span>
        ),
    },
    {
      header: 'Margin',
      sortValue: (row) => row.marginBps,
      numeric: true,
      cell: (row) =>
        row.margin === null || row.marginBps === null ? (
          <span className="text-slate-300">—</span>
        ) : (
          <span
            className={
              row.margin < 0
                ? 'font-medium text-red-700'
                : row.marginBps < 300
                  ? 'text-amber-700'
                  : 'text-slate-900'
            }
          >
            <Money value={row.margin} />
            <span className="block text-xs">{percent(row.marginBps)}</span>
          </span>
        ),
    },
    {
      header: 'Last delivery',
      sortValue: (row) => row.lastDelivery?.cost,
      numeric: true,
      cell: (row) =>
        row.lastDelivery ? (
          <span className="text-slate-600">
            <Money value={row.lastDelivery.cost} />
            <span className="block text-xs text-slate-500">
              {new Date(row.lastDelivery.receivedAt).toLocaleDateString(
                'en-NG',
              )}
              {row.lastDelivery.deal &&
                ` · ${row.lastDelivery.deal.received} for ${row.lastDelivery.deal.paidFor}`}
            </span>
          </span>
        ) : (
          <span className="text-slate-300">—</span>
        ),
    },
  ];

  return (
    <Page
      title="Margins"
      description="Today’s price beside what your stock cost — to set prices by."
      actions={
        <DownloadButton
          disabled={!data}
          onDownload={() => exportMargins(data!)}
        />
      }
    >
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <Field label="Price list" htmlFor="margins-tier">
          <Select
            id="margins-tier"
            value={tierId}
            onChange={(event) => setTierId(event.target.value)}
            className="w-48"
          >
            <option value="">
              {data?.tier ? `${data.tier.name} (default)` : 'Default'}
            </option>
            {tiers
              .filter((tier) => !tier.isDefault)
              .map((tier) => (
                <option key={tier.id} value={tier.id}>
                  {tier.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Category" htmlFor="margins-category">
          <Select
            id="margins-category"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            className="w-48"
          >
            <option value="">All</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <p className="mb-4 text-xs text-slate-500">
        Cost is the average of the stock you have now; the last delivery is
        beside it, with any free goods it came with.{' '}
        {data?.chargesVat
          ? 'Margins are on the price without VAT, as your profit report is.'
          : 'You do not charge VAT, so the margin is on the whole price.'}{' '}
        Red is below cost; amber is under 3%. A forecast from today’s figures —
        it changes nothing already recorded.
      </p>

      <DataTable
        rows={data?.rows ?? []}
        columns={columns}
        rowKey={(row) => `${row.productId}:${row.unitId}`}
        loading={isPending}
        empty="No products sold at the till yet."
      />
    </Page>
  );
}
