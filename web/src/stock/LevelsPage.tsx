import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Money } from '../components/Money';
import { Button } from '../components/Button';
import { Field, Input, Select } from '../components/Field';
import { api } from '../api/client';
import { useRecordsStock, useSeesCost } from '../auth/useAuth';
import type { components } from '../api/schema';
import { AdjustDialog } from './AdjustDialog';
import { TransferDialog } from './TransferDialog';
import { ExpiryPanel } from './ExpiryPanel';

type StockLevelRow = components['schemas']['StockLevelRow'];
type LocationView = components['schemas']['LocationView'];

/**
 * What is on the shelf.
 *
 * Quantities are **base units** — the one unit per product with `factor = 1`
 * (DECISIONS.md §2). Half a carton is six pieces, and there is no decimal
 * anywhere in this screen because there is none in the ledger.
 *
 * A row can read **negative**, and that is the system working rather than a
 * bug: an owner or manager can force a sale past a shortfall, which records
 * that stock left before anybody entered it as received. The fix is a goods
 * receipt, never an edit — the ledger is append-only.
 *
 * Opening a row shows the lots behind the number, which is what FEFO sells in
 * order. The per-lot cost is **absent** for a role that may not see it, so it
 * goes through `<Money>` like everything else (§9).
 */
export function LevelsPage() {
  const seesCost = useSeesCost();
  const recordsStock = useRecordsStock();

  const [locationId, setLocationId] = useState('');
  const [search, setSearch] = useState('');
  const [includeEmpty, setIncludeEmpty] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState<StockLevelRow | null>(null);
  const [transferring, setTransferring] = useState<StockLevelRow | null>(null);

  const query = new URLSearchParams({ includeBatches: 'true' });
  if (locationId) query.set('locationId', locationId);
  if (includeEmpty) query.set('includeEmpty', 'true');

  const { data: levels = [], isPending } = useQuery({
    queryKey: ['stock-levels', query.toString()],
    queryFn: () => api.get<StockLevelRow[]>(`/stock/levels?${query}`),
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: () => api.get<LocationView[]>('/locations'),
  });

  // Filtered here rather than server-side because `GET /stock/levels` takes a
  // productId, not a search: it is one row per product and location, already
  // scoped to a location, so the list a shop scrolls is small.
  const needle = search.trim().toLowerCase();
  const rows = needle
    ? levels.filter(
        (row) =>
          row.product.name.toLowerCase().includes(needle) ||
          row.product.sku.toLowerCase().includes(needle),
      )
    : levels;

  const negatives = rows.filter((row) => row.quantity < 0).length;

  return (
    <Page
      title="Stock on hand"
      description="Counted in base units, straight from the ledger."
    >
      <ExpiryPanel locationId={locationId} />

      <div className="mb-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-3">
        <Field label="Search" htmlFor="level-search">
          <Input
            id="level-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name or SKU"
          />
        </Field>

        <Field label="Location" htmlFor="level-location">
          <Select
            id="level-location"
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
          >
            <option value="">Everywhere</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </Select>
        </Field>

        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeEmpty}
              onChange={(event) => setIncludeEmpty(event.target.checked)}
            />
            <span className="text-slate-700">Show products at zero</span>
          </label>
        </div>
      </div>

      {negatives > 0 && (
        <p className="mb-4 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          {negatives === 1 ? 'One line reads' : `${negatives} lines read`}{' '}
          negative — stock went out before a delivery was recorded. Put it right
          with a goods receipt rather than an adjustment, so the history stays
          true.
        </p>
      )}

      {isPending && <p className="text-sm text-slate-500">Loading…</p>}

      {!isPending && rows.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">
          Nothing on the shelves here yet. Recording a delivery is what puts
          stock in the ledger.
        </div>
      )}

      <div className="space-y-2">
        {rows.map((row) => {
          const key = `${row.product.id}:${row.location.id}`;
          const open = expanded === key;

          return (
            <div
              key={key}
              className="rounded-lg border border-slate-200 bg-white"
            >
              <div className="flex items-center gap-4 p-4">
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : key)}
                  className="flex flex-1 items-center gap-4 text-left"
                  aria-expanded={open}
                >
                  <span className="w-4 text-slate-400">{open ? '−' : '+'}</span>
                  <span className="flex-1">
                    <span className="block font-medium text-slate-900">
                      {row.product.name}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {row.product.sku} · {row.location.name} ·{' '}
                      {row.batches?.length ?? 0} lot
                      {row.batches?.length === 1 ? '' : 's'}
                    </span>
                  </span>
                  <span
                    className={`tabular-nums text-lg font-semibold ${
                      row.quantity < 0 ? 'text-red-600' : 'text-slate-900'
                    }`}
                  >
                    {row.quantity}
                  </span>
                </button>

                {recordsStock && (
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => setAdjusting(row)}
                    >
                      Adjust
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => setTransferring(row)}
                    >
                      Move
                    </Button>
                  </div>
                )}
              </div>

              {open && (
                <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
                  {(row.batches?.length ?? 0) === 0 ? (
                    <p className="text-sm text-slate-500">
                      No lots holding stock here.
                    </p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase text-slate-500">
                          <th className="py-1 font-medium">Lot</th>
                          <th className="py-1 font-medium">Expires</th>
                          <th className="py-1 text-right font-medium">
                            Quantity
                          </th>
                          {seesCost && (
                            <th className="py-1 text-right font-medium">
                              Cost each
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {row.batches?.map((batch) => (
                          <tr key={batch.batchId}>
                            <td className="py-1.5 text-slate-700">
                              {batch.lotCode ?? (
                                <span className="text-slate-400">
                                  no lot code
                                </span>
                              )}
                            </td>
                            <td className="py-1.5 text-slate-700">
                              {batch.expiryDate ? (
                                new Date(batch.expiryDate).toLocaleDateString()
                              ) : (
                                <span className="text-slate-400">
                                  no expiry
                                </span>
                              )}
                            </td>
                            <td className="py-1.5 text-right tabular-nums text-slate-700">
                              {batch.quantity}
                            </td>
                            {seesCost && (
                              <td className="py-1.5 text-right">
                                {/* A ratio, computed on read. The lot stores
                                    the exact invoice total and nothing else. */}
                                <Money value={batch.unitCost} />
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <p className="mt-2 text-xs text-slate-500">
                    Sold oldest-expiry-first, so the top lot goes next.
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {adjusting && (
        <AdjustDialog
          product={adjusting.product}
          location={adjusting.location}
          onHand={adjusting.quantity}
          onClose={() => setAdjusting(null)}
        />
      )}

      {transferring && (
        <TransferDialog
          product={transferring.product}
          from={transferring.location}
          onHand={transferring.quantity}
          locations={locations}
          onClose={() => setTransferring(null)}
        />
      )}
    </Page>
  );
}
