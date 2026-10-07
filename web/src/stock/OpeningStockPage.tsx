import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Button } from '../components/Button';
import { Field, Input, MoneyInput, Select } from '../components/Field';
import { Money } from '../components/Money';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import type { components } from '../api/schema';
import { decimalDraft, toWholeBaseUnits } from '../lib/decimalQuantity';

type OpeningProduct = components['schemas']['OpeningStockProductView'];
type OpeningResult = components['schemas']['OpeningStockResultView'];
type LocationView = components['schemas']['LocationView'];

/**
 * Opening stock: what is on the shelves on day one, and what it cost.
 *
 * ## Not a delivery
 *
 * Recorded as a delivery, goods paid for months ago raised a bill on *We
 * owe* and counted toward this month's vendor targets. This records an
 * opening balance instead: stock in, valued at the cost given, and nothing
 * owed, targeted or counted as bought (DECISIONS.md §5).
 *
 * ## The sheet
 *
 * Every product that has never had stock come in at this location, one line
 * each, starting on its biggest unit. Fill in what you have; a line with no
 * quantity is left out. **A filled line needs its cost** — a lot worth ₦0
 * shows a 100% margin on everything sold from it. "+ loose" adds a second line
 * for the same product, for the rolls outside a full carton.
 *
 * Products leave the sheet once saved, so the same stock cannot be entered
 * twice; a product that already has stock is corrected with a count.
 *
 * What is typed lives here, keyed by product, and is never reseeded from a
 * refetch — a background refetch must not wipe a half-filled sheet.
 */
export function OpeningStockPage() {
  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: () => api.get<LocationView[]>('/locations'),
  });
  const [chosen, setChosen] = useState<string | null>(null);
  const locationId =
    chosen ?? locations.find((row) => row.isDefault)?.id ?? locations[0]?.id;

  return (
    <Page
      title="Opening stock"
      description="What is on your shelves on the day you start, and what you paid for it. Recorded once per product — no bill, nothing owed."
      back={{ to: '/stock/levels', label: 'Stock on hand' }}
    >
      {locations.length > 1 && (
        <div className="mb-4 max-w-xs">
          <Field label="Which location" htmlFor="opening-location">
            <Select
              id="opening-location"
              value={locationId ?? ''}
              onChange={(event) => setChosen(event.target.value)}
            >
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}

      {locationId ? (
        // Keyed on the location: another location is another sheet.
        <Sheet key={locationId} locationId={locationId} />
      ) : (
        <p className="text-sm text-slate-500">Loading…</p>
      )}
    </Page>
  );
}

interface LineDraft {
  key: string;
  unitId: string;
  /** Digits only, as typed. Empty means the line is left out. */
  quantity: string;
  unitCost: number | null;
  expiryDate: string;
}

function Sheet({ locationId }: { locationId: string }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [drafts, setDrafts] = useState<Record<string, LineDraft[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<OpeningResult | null>(null);

  const { data: products = [], isPending } = useQuery({
    queryKey: ['stock-opening', locationId],
    queryFn: () =>
      api.get<OpeningProduct[]>(`/stock/opening?locationId=${locationId}`),
  });

  const linesOf = (product: OpeningProduct): LineDraft[] =>
    drafts[product.id] ?? [
      {
        key: `${product.id}:0`,
        unitId: product.defaultUnitId,
        quantity: '',
        unitCost: null,
        expiryDate: '',
      },
    ];

  const setLines = (productId: string, next: LineDraft[]) => {
    setDrafts((current) => ({ ...current, [productId]: next }));
    setSaved(null);
  };

  const update = (
    product: OpeningProduct,
    key: string,
    change: Partial<LineDraft>,
  ) =>
    setLines(
      product.id,
      linesOf(product).map((line) =>
        line.key === key ? { ...line, ...change } : line,
      ),
    );

  /** A second line for the loose units, on the next unit down. */
  const addLoose = (product: OpeningProduct) => {
    const lines = linesOf(product);
    const last = lines[lines.length - 1];
    const index = product.units.findIndex((unit) => unit.id === last.unitId);
    const smaller = product.units[Math.max(0, index - 1)];
    setLines(product.id, [
      ...lines,
      {
        key: `${product.id}:${Date.now()}`,
        unitId: smaller.id,
        quantity: '',
        unitCost: null,
        expiryDate: '',
      },
    ]);
  };

  const removeLine = (product: OpeningProduct, key: string) =>
    setLines(
      product.id,
      linesOf(product).filter((line) => line.key !== key),
    );

  // Only what is still on the sheet counts: a product saved a moment ago has
  // left it, and so have its lines.
  const filled = products.flatMap((product) =>
    linesOf(product)
      .filter((line) => line.quantity !== '' && Number(line.quantity) > 0)
      .map((line) => ({ product, line })),
  );
  const missingCost = filled.filter(({ line }) => line.unitCost === null);
  // A decimal must come to whole counted-in units — 6.25 cartons of 12 does,
  // 6.1 does not. Checked here so the line says so before saving; the server
  // checks again (2026-10-07).
  const notWhole = filled.filter(
    ({ product, line }) => quantityProblem(product, line) !== null,
  );
  const filledProducts = new Set(filled.map(({ product }) => product.id)).size;

  const save = useMutation({
    mutationFn: () =>
      api.post<OpeningResult>('/stock/opening', {
        locationId,
        lines: filled.map(({ product, line }) => ({
          productId: product.id,
          unitId: line.unitId,
          quantity: Number(line.quantity),
          unitCost: line.unitCost,
          ...(line.expiryDate && { expiryDate: line.expiryDate }),
        })),
      }),
    onSuccess: (result) => {
      afterWrite(queryClient);
      setDrafts({});
      setError(null);
      setSaved(result);
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not save the opening stock. Check the connection and try again.',
      ),
  });

  const needle = search.trim().toLowerCase();
  const shown = needle
    ? products.filter((product) =>
        [product.name, product.sku, product.size ?? '', product.category ?? '']
          .join(' ')
          .toLowerCase()
          .includes(needle),
      )
    : products;

  if (isPending) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div className="space-y-4">
      {saved && (
        <div className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">
          Opening stock saved for {saved.products}{' '}
          {saved.products === 1 ? 'product' : 'products'}, worth{' '}
          <Money value={saved.totalValue} />.{' '}
          <Link to="/stock/levels" className="underline">
            See it on hand
          </Link>
        </div>
      )}

      {products.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
          Every product already has stock here. To put a count right, use{' '}
          <Link to="/stock/counts" className="underline">
            a stock count
          </Link>
          .
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="w-full max-w-sm">
              <Field
                label="Search"
                htmlFor="opening-search"
                hint={`${products.length} ${products.length === 1 ? 'product has' : 'products have'} no stock here yet.`}
              >
                <Input
                  id="opening-search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Name, size, category or SKU"
                />
              </Field>
            </div>
            <SaveBar
              filledProducts={filledProducts}
              missingCost={missingCost.length}
              notWhole={notWhole.length}
              busy={save.isPending}
              onSave={() => save.mutate()}
            />
          </div>

          {error && (
            <p
              className="rounded-md bg-red-50 p-3 text-sm text-red-700"
              role="alert"
            >
              {error}
            </p>
          )}

          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2">How many</th>
                  <th className="px-3 py-2">Unit</th>
                  <th className="px-3 py-2">Cost per unit</th>
                  <th className="px-3 py-2">Expiry (optional)</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((product) =>
                  linesOf(product).map((line, index) => {
                    const unitName =
                      product.units.find((unit) => unit.id === line.unitId)
                        ?.name ?? 'unit';
                    const needsCost =
                      line.quantity !== '' && line.unitCost === null;
                    const problem = quantityProblem(product, line);
                    return (
                      <tr key={line.key} className="align-top">
                        <td className="px-3 py-2">
                          {index === 0 ? (
                            <>
                              <div className="font-medium text-slate-900">
                                {product.name}
                                {product.size && (
                                  <span className="ml-1 font-normal text-slate-500">
                                    {product.size}
                                  </span>
                                )}
                              </div>
                              {product.category && (
                                <div className="text-xs text-slate-500">
                                  {product.category}
                                </div>
                              )}
                            </>
                          ) : (
                            <span className="pl-3 text-xs text-slate-500">
                              loose
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            aria-label={`How many ${unitName} of ${product.name}`}
                            inputMode="decimal"
                            className="w-24"
                            value={line.quantity}
                            onChange={(event) =>
                              update(product, line.key, {
                                // Digits and one dot — 6.25 cartons is one
                                // line, not cartons plus a loose line.
                                quantity: decimalDraft(event.target.value),
                              })
                            }
                          />
                          {problem && (
                            <div className="mt-1 max-w-[12rem] text-xs text-red-600">
                              {problem}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Select
                            aria-label={`Unit for ${product.name}`}
                            className="w-36"
                            value={line.unitId}
                            onChange={(event) =>
                              update(product, line.key, {
                                unitId: event.target.value,
                                // A cost typed for a carton is not the cost
                                // of a piece. Keeping it when the unit changes
                                // would value the stock at the wrong unit,
                                // silently — so it is asked again.
                                unitCost: null,
                              })
                            }
                          >
                            {product.units.map((unit) => (
                              <option key={unit.id} value={unit.id}>
                                {unit.factor === 1
                                  ? unit.name
                                  : `${unit.name} (${unit.factor})`}
                              </option>
                            ))}
                          </Select>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <MoneyInput
                              id={`opening-cost-${line.key}`}
                              aria-label={`Cost per ${unitName} of ${product.name}`}
                              className="w-32"
                              value={line.unitCost}
                              onChange={(unitCost) =>
                                update(product, line.key, { unitCost })
                              }
                              placeholder="0.00"
                            />
                            {/* Always visible: the cost is for one of the unit
                                on this line, and a placeholder vanishes the
                                moment somebody types. */}
                            <span className="whitespace-nowrap text-xs text-slate-500">
                              per {unitName}
                            </span>
                          </div>
                          {needsCost && (
                            <div className="mt-1 text-xs text-red-600">
                              What did one {unitName} cost?
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="date"
                            aria-label={`Expiry for ${product.name}`}
                            className="w-40"
                            value={line.expiryDate}
                            onChange={(event) =>
                              update(product, line.key, {
                                expiryDate: event.target.value,
                              })
                            }
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          {index === 0 ? (
                            product.units.length > 1 && (
                              <Button
                                type="button"
                                variant="ghost"
                                onClick={() => addLoose(product)}
                              >
                                + loose
                              </Button>
                            )
                          ) : (
                            <Button
                              type="button"
                              variant="ghost"
                              aria-label={`Remove this line for ${product.name}`}
                              onClick={() => removeLine(product, line.key)}
                            >
                              ×
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end">
            <SaveBar
              filledProducts={filledProducts}
              missingCost={missingCost.length}
              notWhole={notWhole.length}
              busy={save.isPending}
              onSave={() => save.mutate()}
            />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Why a line's quantity cannot be saved, in words — or null when it can.
 * Empty lines are fine: they are simply not sent.
 */
function quantityProblem(
  product: OpeningProduct,
  line: { quantity: string; unitId: string },
): string | null {
  if (line.quantity === '' || Number(line.quantity) === 0) return null;
  const unit = product.units.find((row) => row.id === line.unitId);
  const base = product.units.find((row) => row.factor === 1);
  if (!unit || !base) return null;
  // "6." is somebody halfway through typing 6.5, not a mistake.
  const read = toWholeBaseUnits(
    line.quantity.replace(/\.$/, ''),
    unit.factor,
    unit.name,
    base.name,
  );
  return 'error' in read ? read.error : null;
}

/** The save button, with the reason it is not ready when it is not. */
function SaveBar({
  filledProducts,
  missingCost,
  notWhole,
  busy,
  onSave,
}: {
  filledProducts: number;
  missingCost: number;
  notWhole: number;
  busy: boolean;
  onSave: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {notWhole > 0 && (
        <span className="text-sm text-red-700">
          {notWhole} {notWhole === 1 ? 'quantity does' : 'quantities do'} not
          come to whole units.
        </span>
      )}
      {missingCost > 0 && (
        <span className="text-sm text-red-700">
          {missingCost} {missingCost === 1 ? 'line needs' : 'lines need'} a
          cost.
        </span>
      )}
      <Button
        type="button"
        onClick={onSave}
        disabled={
          busy || filledProducts === 0 || missingCost > 0 || notWhole > 0
        }
      >
        {busy
          ? 'Saving…'
          : filledProducts === 0
            ? 'Fill in a quantity to save'
            : `Save opening stock for ${filledProducts} ${filledProducts === 1 ? 'product' : 'products'}`}
      </Button>
    </div>
  );
}
