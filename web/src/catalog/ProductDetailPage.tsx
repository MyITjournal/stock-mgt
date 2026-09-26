import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Money } from '../components/Money';
import { Button } from '../components/Button';
import { DataTable, type Column } from '../components/DataTable';
import { api, ApiError } from '../api/client';
import { useSeesCost } from '../auth/useAuth';
import type { components } from '../api/schema';
import { ProductForm } from './ProductForm';

type ProductView = components['schemas']['ProductView'];
type StockLevelRow = components['schemas']['StockLevelRow'];
type MovementPageView = components['schemas']['MovementPageView'];
type SyncedMovementView = components['schemas']['SyncedMovementView'];

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

/**
 * One product, and what has happened to it.
 *
 * **This exists to show what the edit form cannot.** The form says what a
 * product *is* — its units, its prices, its codes — and a detail screen that
 * repeated those with the inputs greyed out would earn nothing. What is
 * missing from every other screen is the product's own trading history: where
 * its stock actually sits, which lots it is sitting in, and what has moved it.
 *
 * Cost fields are absent rather than null for a role that may not see them,
 * so every amount goes through `<Money>` (DECISIONS.md §9). A rep opening
 * this page gets the stock and the movements, which is the part of it that is
 * their job.
 */
export function ProductDetailPage() {
  const { id = '' } = useParams();
  const seesCost = useSeesCost();
  const [editing, setEditing] = useState(false);

  const { data: product, isPending, error } = useQuery({
    queryKey: ['product', id],
    queryFn: () => api.get<ProductView>(`/products/${id}`),
  });

  const { data: levels = [] } = useQuery({
    queryKey: ['stock-levels', `productId=${id}`],
    queryFn: () =>
      api.get<StockLevelRow[]>(
        `/stock/levels?productId=${id}&includeBatches=true&includeEmpty=true`,
      ),
    enabled: Boolean(id),
  });

  const { data: ledger } = useQuery({
    queryKey: ['stock-movements', `productId=${id}`],
    queryFn: () =>
      api.get<MovementPageView>(
        `/stock/movements?productId=${id}&order=desc&limit=50`,
      ),
    enabled: Boolean(id),
  });

  if (isPending) {
    return (
      <Page title="Product" back={{ to: '/stock', label: 'Products' }}>
        <p className="text-sm text-slate-500">Loading…</p>
      </Page>
    );
  }

  if (error || !product) {
    return (
      <Page title="Product" back={{ to: '/stock', label: 'Products' }}>
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error instanceof ApiError
            ? error.message
            : 'That product could not be loaded.'}
        </p>
      </Page>
    );
  }

  const onHand = levels.reduce((sum, row) => sum + row.quantity, 0);
  const baseUnit = product.units.find((unit) => unit.factor === 1);
  const movements = ledger?.movements ?? [];

  const movementColumns: readonly Column<SyncedMovementView>[] = [
    {
      header: 'When',
      cell: (row) => (
        <span className="whitespace-nowrap text-slate-600">
          {new Date(row.occurredAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      header: 'What happened',
      cell: (row) => (
        <span>
          {TYPE_LABELS[row.type] ?? row.type}
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
        row.batch.lotCode ?? <span className="text-slate-300">—</span>,
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

  return (
    <Page
      back={{ to: '/stock', label: 'Products' }}
      title={product.name}
      description={`${product.sku}${product.category ? ` · ${product.category.name}` : ''}${product.isActive ? '' : ' · retired'}`}
      actions={<Button onClick={() => setEditing(true)}>Edit</Button>}
    >
      <section className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={`On hand${baseUnit ? ` (${baseUnit.name})` : ''}`}
          value={
            <span className={onHand < 0 ? 'text-red-600' : undefined}>
              {onHand}
            </span>
          }
          note={
            product.trackStock ? undefined : 'Not stocked — sold without a ledger'
          }
        />
        <Stat
          label="Base price"
          value={<Money value={product.basePrice} />}
          note={baseUnit ? `per ${baseUnit.name}` : undefined}
        />
        {seesCost && (
          <Stat
            label="Last cost"
            value={<Money value={product.costPrice} />}
            note="From the most recent delivery"
          />
        )}
        <Stat
          label="Reorder at"
          value={product.reorderPoint ?? '—'}
          note={product.reorderPoint === null ? 'No level set' : undefined}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-900">
            Where the stock is
          </h2>
          <DataTable
            rows={levels}
            columns={[
              { header: 'Location', cell: (row) => row.location.name },
              {
                header: 'Lots',
                numeric: true,
                cell: (row) => row.batches?.length ?? 0,
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
            ]}
            rowKey={(row) => row.location.id}
            empty="None anywhere. A delivery is what puts stock in the ledger."
          />
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-900">
            Prices per unit
          </h2>
          <DataTable
            rows={product.prices}
            columns={[
              { header: 'Unit', cell: (row) => row.unit.name },
              {
                header: 'Price',
                numeric: true,
                cell: (row) => <Money value={row.price} />,
              },
              {
                header: 'Per base unit',
                numeric: true,
                cell: (row) => (
                  <Money value={Math.round(row.price / row.unit.factor)} />
                ),
              },
            ]}
            rowKey={(row) => row.id}
            empty="No tier prices — every unit uses base price × factor."
          />
          <p className="mt-2 text-xs text-slate-500">
            A unit with no price here falls back to base price × factor, which
            is right for a sachet and usually wrong for a carton.
          </p>
        </section>
      </div>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">
          The lots on the shelf
        </h2>
        <DataTable
          rows={levels.flatMap((row) =>
            (row.batches ?? []).map((batch) => ({
              ...batch,
              locationName: row.location.name,
            })),
          )}
          columns={[
            { header: 'Where', cell: (row) => row.locationName },
            {
              header: 'Lot',
              cell: (row) =>
                row.lotCode ?? <span className="text-slate-300">no code</span>,
            },
            {
              header: 'Expires',
              cell: (row) =>
                row.expiryDate ? (
                  new Date(row.expiryDate).toLocaleDateString()
                ) : (
                  <span className="text-slate-300">—</span>
                ),
            },
            { header: 'On hand', numeric: true, cell: (row) => row.quantity },
            ...(seesCost
              ? [
                  {
                    header: 'Cost each',
                    numeric: true,
                    cell: (row: { unitCost?: number | null }) => (
                      <Money value={row.unitCost} />
                    ),
                  },
                ]
              : []),
          ]}
          rowKey={(row) => row.batchId}
          empty="No lots holding stock."
        />
        <p className="mt-2 text-xs text-slate-500">
          Sold oldest-expiry-first, so the top lot goes next.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">
          What has moved
        </h2>
        <DataTable
          rows={movements}
          columns={movementColumns}
          rowKey={(row) => row.id}
          empty="Nothing has moved yet."
        />
        <p className="mt-2 text-xs text-slate-500">
          The fifty most recent, newest first, in base units. Append-only —
          a mistake here is corrected by another movement, never by editing
          this one.
        </p>
      </section>

      {product.barcodes.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">
            Barcodes
          </h2>
          <ul className="space-y-1 text-sm text-slate-600">
            {product.barcodes.map((barcode) => (
              <li key={barcode.id}>
                <span className="tabular-nums">{barcode.code}</span>
                <span className="ml-2 text-xs text-slate-400">
                  {barcode.unit.name} · {barcode.symbology}
                  {barcode.isPrimary ? ' · printed on labels' : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {editing && (
        <ProductForm product={product} onClose={() => setEditing(false)} />
      )}
    </Page>
  );
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: React.ReactNode;
  note?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      {note && <div className="mt-1 text-xs text-slate-500">{note}</div>}
    </div>
  );
}
