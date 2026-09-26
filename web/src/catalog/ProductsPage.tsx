import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Money } from '../components/Money';
import { Button } from '../components/Button';
import { Field, Input, Select } from '../components/Field';
import { api } from '../api/client';
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
  const seesCost = useSeesCost();
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [editing, setEditing] = useState<ProductView | null>(null);
  const [creating, setCreating] = useState(false);

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
              <tr key={product.id} className="hover:bg-slate-50">
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
                  <Button
                    variant="secondary"
                    onClick={() => setEditing(product)}
                  >
                    Edit
                  </Button>
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
    </Page>
  );
}
