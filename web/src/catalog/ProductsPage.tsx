import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Money } from '../components/Money';
import { Button } from '../components/Button';
import { Field, Input, Select } from '../components/Field';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import { useSeesCost } from '../auth/useAuth';
import type { components } from '../api/schema';
import { ProductForm } from './ProductForm';

type ProductView = components['schemas']['ProductView'];
type CategoryView = components['schemas']['CategoryView'];

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

  return (
    <Page
      title="Products"
      description="What the shop sells, how it is packaged, and what it costs."
      actions={<Button onClick={() => setCreating(true)}>Add product</Button>}
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
              <th className="px-4 py-2 font-medium">Product</th>
              <th className="px-4 py-2 font-medium">Units</th>
              <th className="px-4 py-2 text-right font-medium">Base price</th>
              {seesCost && (
                <th className="px-4 py-2 text-right font-medium">Cost</th>
              )}
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isPending && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            )}
            {!isPending && products.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  Nothing matches that.
                </td>
              </tr>
            )}
            {products.map((product) => (
              <tr
                key={product.id}
                className="cursor-pointer transition hover:bg-slate-50"
                onClick={() => navigate(`/stock/products/${product.id}`)}
              >
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-900">
                    {product.name}
                  </div>
                  <div className="text-xs text-slate-500">
                    {product.sku}
                    {!product.trackStock && ' · not stocked'}
                    {!product.isActive && ' · inactive'}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-slate-600">
                  {product.units
                    .map((unit) =>
                      unit.factor === 1
                        ? unit.name
                        : `${unit.name} × ${unit.factor}`,
                    )
                    .join(', ')}
                </td>
                <td className="px-4 py-3 text-right">
                  <Money value={product.basePrice} />
                </td>
                {seesCost && (
                  <td className="px-4 py-3 text-right">
                    <Money value={product.costPrice} />
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
        <RetireDialog
          product={retiring}
          onClose={() => setRetiring(null)}
        />
      )}
    </Page>
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
          retire it once it has sold through, or write it off with an
          adjustment first.
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
