import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Money } from '../components/Money';
import { Button } from '../components/Button';
import { Field, Input, Select } from '../components/Field';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import { useIsManager, useSeesCost } from '../auth/useAuth';
import type { components } from '../api/schema';
import { ProductForm } from './ProductForm';
import { DownloadButton } from '../components/DownloadButton';
import { exportProducts } from './exportProducts';
import { describeCount } from '../lib/quantity';
import { sortRows, useSort, type SortValue } from '../lib/sort';
import { SortHeading } from '../components/SortHeading';
import { costIn, shelfPrice, type PerUnit } from '../lib/shelfPrice';

type ProductView = components['schemas']['ProductView'];
type CategoryView = components['schemas']['CategoryView'];
type StockLevelRow = components['schemas']['StockLevelRow'];

/**
 * What the business sells.
 *
 * `costPrice` is shown only to a role that may see it, and the check is on the
 * role rather than on the value: `redactCost` removes the key, so it is
 * genuinely absent for a rep rather than null (DECISIONS.md §9). It can *also*
 * be null for an owner, when nothing has ever been bought — `<Money>` renders
 * an em dash for both, which is the only honest rendering of two different
 * facts that look the same on a screen.
 */
export function ProductsPage() {
  const navigate = useNavigate();
  const seesCost = useSeesCost();
  // Importing is a catalog write, owner and manager only, like the server.
  const canImport = useIsManager();
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [editing, setEditing] = useState<ProductView | null>(null);
  const [creating, setCreating] = useState(false);
  const [retiring, setRetiring] = useState<ProductView | null>(null);

  const query = new URLSearchParams();
  if (search.trim()) query.set('search', search.trim());
  if (categoryId) query.set('categoryId', categoryId);

  const { data: products = [], isPending } = useQuery({
    queryKey: ['products', query.toString()],
    queryFn: () => api.get<ProductView[]>(`/products?${query}`),
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<CategoryView[]>('/categories'),
  });

  const { sort, toggle } = useSort();

  // One request for the whole shop, summed per product across locations —
  // the same sum the product page shows, without a request per row. Lots are
  // left out: this column is a count, and the lots are a click away.
  const { data: levels = [] } = useQuery({
    queryKey: ['stock-levels', 'all'],
    queryFn: () => api.get<StockLevelRow[]>('/stock/levels'),
  });
  const onHand = new Map<string, number>();
  for (const row of levels) {
    onHand.set(
      row.product.id,
      (onHand.get(row.product.id) ?? 0) + row.quantity,
    );
  }
  const columns = seesCost ? 6 : 5;

  // Tap a heading to sort; the search and category still narrow first.
  const sortValue: Record<string, (product: ProductView) => SortValue> = {
    name: (product) => `${product.name} ${product.size ?? ''}`,
    onHand: (product) =>
      product.trackStock ? (onHand.get(product.id) ?? 0) : null,
    price: (product) => shelfPrice(product)?.amount,
    cost: (product) => costIn(product)?.amount,
  };
  const shown = sort
    ? sortRows(products, sortValue[sort.key], sort.direction)
    : products;

  return (
    <Page
      title="Products"
      description="What the shop sells, how it is packaged, and what it costs."
      actions={
        <>
          <DownloadButton onDownload={() => exportProducts(seesCost)} />
          {canImport && (
            <Button
              variant="secondary"
              onClick={() => navigate('/stock/import')}
            >
              Import from spreadsheet
            </Button>
          )}
          <Button onClick={() => setCreating(true)}>Add product</Button>
        </>
      }
    >
      <div className="mb-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-3">
        <Field label="Search" htmlFor="product-search">
          <Input
            id="product-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name or SKU"
          />
        </Field>
        <Field label="Category" htmlFor="product-category">
          <Select
            id="product-category"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
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

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <SortHeading
                label="Product"
                sortKey="name"
                sort={sort}
                onToggle={toggle}
              />
              <th className="px-4 py-2 font-medium">Units</th>
              <SortHeading
                label="On hand"
                sortKey="onHand"
                sort={sort}
                onToggle={toggle}
                numeric
              />
              <SortHeading
                label="Price"
                sortKey="price"
                sort={sort}
                onToggle={toggle}
                numeric
              />
              {seesCost && (
                <SortHeading
                  label="Cost"
                  sortKey="cost"
                  sort={sort}
                  onToggle={toggle}
                  numeric
                />
              )}
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isPending && (
              <tr>
                <td
                  colSpan={columns}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  Loading…
                </td>
              </tr>
            )}
            {!isPending && products.length === 0 && (
              <tr>
                <td
                  colSpan={columns}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  Nothing matches that.
                </td>
              </tr>
            )}
            {shown.map((product) => (
              <tr
                key={product.id}
                className="cursor-pointer transition hover:bg-slate-50"
                onClick={() => navigate(`/stock/products/${product.id}`)}
              >
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-900">
                    {product.name}
                    {product.size && (
                      <span className="ml-2 font-normal text-slate-500">
                        {product.size}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500">
                    {product.sku}
                    {!product.trackStock && ' · not stocked'}
                    {!product.isActive && ' · inactive'}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-slate-600">
                  {/* A unit only counted in is still listed — it is what On
                      hand is in — but marked, so nobody wonders why the
                      till never offers it. */}
                  {product.units
                    .map(
                      (unit) =>
                        (unit.factor === 1
                          ? unit.name
                          : `${unit.name} × ${unit.factor}`) +
                        (unit.isSellable ? '' : ' (not sold)'),
                    )
                    .join(', ')}
                </td>
                <td className="px-4 py-3 text-right">
                  <OnHand
                    product={product}
                    quantity={onHand.get(product.id) ?? 0}
                  />
                </td>
                <td className="px-4 py-3 text-right">
                  <PerUnitAmount value={shelfPrice(product)} none="no price" />
                </td>
                {seesCost && (
                  <td className="px-4 py-3 text-right">
                    {/* What one of the unit the price is in costs now — the
                        average of the stock on hand — a carton beside a
                        carton. */}
                    <PerUnitAmount value={costIn(product)} none="none yet" />
                  </td>
                )}
                <td className="px-4 py-3 text-right">
                  {/*
                    Both buttons stop propagation: the row navigates to the
                    product page, and a button inside it must do its own thing
                    instead, not as well. Retire needs this as much as Edit —
                    opening a confirmation and changing page at the same time
                    would leave somebody confirming a dialog on top of a screen
                    they did not ask for.
                  */}
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="secondary"
                      onClick={(event) => {
                        event.stopPropagation();
                        setEditing(product);
                      }}
                    >
                      Edit
                    </Button>
                    {product.isActive && (
                      <Button
                        variant="ghost"
                        onClick={(event) => {
                          event.stopPropagation();
                          setRetiring(product);
                        }}
                      >
                        Retire
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(creating || editing) && (
        <ProductForm
          product={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {retiring && (
        <RetireDialog product={retiring} onClose={() => setRetiring(null)} />
      )}
    </Page>
  );
}

/**
 * Stock on hand, counted in base units (§5) and **said** in the units a shop
 * uses — "14 carton, 2 roll, 5 sachet" rather than 2,965 — by `describeCount`.
 * Display only: the exact base count is on hover, and nothing is computed
 * from the words.
 *
 * A service has no stock to count, so it shows a dash rather than a zero — a
 * zero would read as "sold out" and send somebody to reorder a delivery charge.
 * Negative is possible (a forced sale ran past the ledger) and is shown in red
 * rather than hidden, because it is the thing somebody needs to fix.
 */
/** "₦12,500" over "/ carton"; `none` when there is no figure. */
function PerUnitAmount({
  value,
  none,
}: {
  value: PerUnit | null | undefined;
  none: string;
}) {
  if (!value) return <span className="text-xs text-slate-400">{none}</span>;
  return (
    <span>
      <Money value={value.amount} />
      <span className="block text-xs text-slate-500">/ {value.unitName}</span>
    </span>
  );
}

function OnHand({
  product,
  quantity,
}: {
  product: ProductView;
  quantity: number;
}) {
  if (!product.trackStock) return <span className="text-slate-400">—</span>;
  const base = product.units.find((unit) => unit.isBase)?.name ?? '';
  // Biggest unit first — "14 carton, 2 roll, 5 sachet" — with the exact count
  // in the counted-in unit on hover, for whoever is reconciling a count sheet.
  return (
    <span
      title={`${quantity.toLocaleString()} ${base} in all`}
      className={`tabular-nums ${quantity < 0 ? 'text-red-600' : quantity === 0 ? 'text-slate-400' : 'text-slate-900'}`}
    >
      {describeCount(quantity, product.units)}
    </span>
  );
}

/**
 * Taking a product out of use.
 *
 * **It is a retirement, not a deletion, and the word matters.** The server
 * soft-deletes: the row stays, `isActive` goes false, and every sale, stock
 * movement and receipt line that points at it still says what was sold. A
 * button labelled "Delete" would promise something the system deliberately
 * will not do — and something a shop should not want, since it would erase
 * what last month's figures were made of.
 *
 * What it does change is that the product stops appearing where somebody
 * would pick it: the till, the delivery form, a count sheet.
 */
function RetireDialog({
  product,
  onClose,
}: {
  product: ProductView;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const retire = useMutation({
    mutationFn: () => api.delete<void>(`/products/${product.id}`),
    onSuccess: () => {
      afterWrite(queryClient);
      onClose();
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not retire that product.',
      ),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="retire-title"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-lg">
        <h2 id="retire-title" className="text-lg font-semibold text-slate-900">
          Retire {product.name}?
        </h2>

        <p className="mt-2 text-sm text-slate-500">
          It stops appearing at the till, on a delivery and on a count sheet.
        </p>

        <p className="mt-2 text-sm text-slate-500">
          Nothing is erased: past sales, deliveries and stock movements still
          name it, so last month&rsquo;s figures stay whatever they were. Any
          stock still on the shelf stays on the shelf and keeps its value —
          retire it once it has sold through, or write it off with an adjustment
          first.
        </p>

        {error && (
          <p
            className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700"
            role="alert"
          >
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={retire.isPending}
          >
            Keep it
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={() => retire.mutate()}
            disabled={retire.isPending}
          >
            {retire.isPending ? 'Retiring…' : 'Retire it'}
          </Button>
        </div>
      </div>
    </div>
  );
}
