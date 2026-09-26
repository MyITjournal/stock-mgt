import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { DataTable, type Column } from '../components/DataTable';
import { Button } from '../components/Button';
import { Field, Input, Select } from '../components/Field';
import { api } from '../api/client';
import type { components } from '../api/schema';

type MovementPageView = components['schemas']['MovementPageView'];
type SyncedMovementView = components['schemas']['SyncedMovementView'];
type LocationView = components['schemas']['LocationView'];
type ProductView = components['schemas']['ProductView'];

/** What each movement type is called out loud. */
const TYPE_LABELS: Record<string, string> = {
  receipt: 'Delivery',
  sale: 'Sold',
  return_in: 'Returned',
  return_out: 'Sent back',
  adjustment: 'Adjusted',
  transfer_in: 'Moved in',
  transfer_out: 'Moved out',
  damage: 'Damaged',
};

const REASON_LABELS: Record<string, string> = {
  damage: 'damaged',
  expiry: 'expired',
  theft: 'missing',
  count_correction: 'after counting',
  opening_balance: 'opening balance',
  other: 'other',
};

/**
 * The ledger, newest first.
 *
 * **Append-only.** Nothing on this screen can be edited, and that is the point:
 * a mistake is corrected by another movement, so the history stays true
 * (DECISIONS.md §3). The sum of everything here is the sum of stock on hand,
 * which is the one check `npm run smoke` treats as load-bearing.
 *
 * Read with `order=desc`, which is the browsing half of a feed whose other half
 * is delta sync for the mobile app. Browsing skips the one-second sync lag, so
 * a movement recorded a moment ago is here rather than missing for a second
 * — that lag exists to stop a *forward* cursor stepping over a row still
 * committing, and reading newest-first has the opposite exposure (§8).
 */
export function MovementsPage() {
  const [locationId, setLocationId] = useState('');
  const [productId, setProductId] = useState('');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [cursors, setCursors] = useState<string[]>([]);

  const cursor = cursors.at(-1);

  const query = new URLSearchParams({ order: 'desc', limit: '50' });
  if (locationId) query.set('locationId', locationId);
  if (productId) query.set('productId', productId);
  if (since) query.set('since', new Date(since).toISOString());
  if (until) query.set('until', new Date(`${until}T23:59:59`).toISOString());
  if (cursor) query.set('cursor', cursor);

  const { data, isPending } = useQuery({
    queryKey: ['stock-movements', query.toString()],
    queryFn: () => api.get<MovementPageView>(`/stock/movements?${query}`),
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: () => api.get<LocationView[]>('/locations'),
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products', ''],
    queryFn: () => api.get<ProductView[]>('/products'),
  });

  const productName = new Map(products.map((p) => [p.id, p.name]));
  const locationName = new Map(locations.map((l) => [l.id, l.name]));

  /** Any filter change restarts the walk: a cursor belongs to one query. */
  const refilter = (apply: () => void) => {
    apply();
    setCursors([]);
  };

  const columns: readonly Column<SyncedMovementView>[] = [
    {
      header: 'When',
      cell: (row) => (
        <span className="whitespace-nowrap text-slate-600">
          {new Date(row.occurredAt).toLocaleString()}
        </span>
      ),
    },
    {
      header: 'Product',
      cell: (row) => (
        <span className="text-slate-900">
          {productName.get(row.productId) ?? row.productId.slice(0, 8)}
        </span>
      ),
    },
    {
      header: 'Where',
      cell: (row) => locationName.get(row.locationId) ?? '—',
    },
    {
      header: 'What happened',
      cell: (row) => (
        <span>
          {TYPE_LABELS[row.type] ?? row.type}
          {row.reason && (
            <span className="text-slate-500">
              {' '}
              · {REASON_LABELS[row.reason] ?? row.reason}
            </span>
          )}
          {row.isForced && (
            <span
              className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800"
              title={row.forcedReason ?? undefined}
            >
              forced
            </span>
          )}
        </span>
      ),
    },
    {
      header: 'Lot',
      cell: (row) =>
        row.batch.lotCode ?? <span className="text-slate-400">—</span>,
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
  ];

  const movements = data?.movements ?? [];

  return (
    <Page
      title="Movements"
      description="Everything that has moved, newest first. Nothing here can be edited."
    >
      <div className="mb-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-4">
        <Field label="Product" htmlFor="movement-product">
          <Select
            id="movement-product"
            value={productId}
            onChange={(event) =>
              refilter(() => setProductId(event.target.value))
            }
          >
            <option value="">Everything</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Location" htmlFor="movement-location">
          <Select
            id="movement-location"
            value={locationId}
            onChange={(event) =>
              refilter(() => setLocationId(event.target.value))
            }
          >
            <option value="">Everywhere</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="From" htmlFor="movement-since">
          <Input
            id="movement-since"
            type="date"
            value={since}
            onChange={(event) => refilter(() => setSince(event.target.value))}
          />
        </Field>

        <Field label="To" htmlFor="movement-until">
          <Input
            id="movement-until"
            type="date"
            value={until}
            onChange={(event) => refilter(() => setUntil(event.target.value))}
          />
        </Field>
      </div>

      <DataTable
        rows={movements}
        columns={columns}
        rowKey={(row) => row.id}
        loading={isPending}
        empty="No movements in this window."
      />

      <div className="mt-4 flex items-center justify-between">
        <Button
          variant="secondary"
          disabled={cursors.length === 0}
          onClick={() => setCursors(cursors.slice(0, -1))}
        >
          Newer
        </Button>
        <span className="text-xs text-slate-500">
          {movements.length} movement{movements.length === 1 ? '' : 's'}
        </span>
        <Button
          variant="secondary"
          disabled={!data?.nextCursor}
          onClick={() =>
            data?.nextCursor && setCursors([...cursors, data.nextCursor])
          }
        >
          Older
        </Button>
      </div>
    </Page>
  );
}
