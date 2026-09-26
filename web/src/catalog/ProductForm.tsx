import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../components/Button';
import { Field, Input, MoneyInput, Select } from '../components/Field';
import { QuantityInput } from '../components/QuantityInput';
import { api, ApiError } from '../api/client';
import { useSeesCost } from '../auth/useAuth';
import type { components } from '../api/schema';

type ProductView = components['schemas']['ProductView'];
type CategoryView = components['schemas']['CategoryView'];
type PackagingTypeView = components['schemas']['PackagingTypeView'];
type PriceTierView = components['schemas']['PriceTierView'];

interface UnitDraft {
  name: string;
  factor: number;
  existing: boolean;
  isBase: boolean;
}

interface PriceDraft {
  unit: string;
  tierId: string;
  price: number | null;
  existing: boolean;
}

/**
 * Adding and editing a product — the one form where the server's write
 * semantics are unusual enough that the screen has to explain itself.
 *
 * **Units, prices and barcodes all upsert and never delete what they are not
 * sent** (DECISIONS.md §4). A PATCH naming one unit must not wipe the prices of
 * the rest, so the server leaves anything unlisted alone. The consequence for a
 * form is easy to get wrong: a list with remove buttons would *imply*
 * replace-all, and removing a row would silently do nothing at all.
 *
 * So nothing here offers to remove a unit or a price, and the form says why
 * rather than leaving somebody to discover it:
 *
 * - **Units cannot be deleted** because movements, sale lines and receipt lines
 *   point at them; removing one would orphan history that is meant to be
 *   immutable.
 * - **Prices cannot be deleted** because there is no endpoint for it, and that
 *   is deliberate: a unit with no tier price falls back to `basePrice ×
 *   factor`, which is right for a sachet and wrong for a carton — the silent
 *   overcharge the per-unit price list exists to prevent. Change a price rather
 *   than removing it.
 * - **Barcodes can be deleted**, because `DELETE /barcodes/:id` exists and
 *   detaching a code from a product is an ordinary thing to want.
 *
 * The base unit also cannot move once set: stock is recorded in base units, so
 * changing which unit that is would reinterpret every quantity in the ledger.
 */
export function ProductForm({
  product,
  onClose,
}: {
  product: ProductView | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const seesCost = useSeesCost();
  const editing = product !== null;

  const [name, setName] = useState(product?.name ?? '');
  const [sku, setSku] = useState(product?.sku ?? '');
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? '');
  const [packagingTypeId, setPackagingTypeId] = useState(
    product?.packagingTypeId ?? '',
  );
  const [basePrice, setBasePrice] = useState<number | null>(
    product?.basePrice ?? null,
  );
  const [costPrice, setCostPrice] = useState<number | null>(
    product?.costPrice ?? null,
  );
  const [taxRateBps, setTaxRateBps] = useState(product?.taxRateBps ?? 750);
  const [trackStock, setTrackStock] = useState(product?.trackStock ?? true);
  const [reorderPoint, setReorderPoint] = useState<string>(
    product?.reorderPoint === null || product?.reorderPoint === undefined
      ? ''
      : String(product.reorderPoint),
  );
  const [error, setError] = useState<string | null>(null);

  const [units, setUnits] = useState<UnitDraft[]>(
    product
      ? product.units.map((unit) => ({
          name: unit.name,
          factor: unit.factor,
          existing: true,
          isBase: unit.isBase,
        }))
      : [{ name: 'piece', factor: 1, existing: false, isBase: true }],
  );

  const [prices, setPrices] = useState<PriceDraft[]>(
    product
      ? product.prices.map((price) => ({
          unit: price.unit.name,
          tierId: price.tierId,
          price: price.price,
          existing: true,
        }))
      : [],
  );

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<CategoryView[]>('/categories'),
  });
  const { data: packagingTypes = [] } = useQuery({
    queryKey: ['packaging-types'],
    queryFn: () => api.get<PackagingTypeView[]>('/packaging-types'),
  });
  const { data: tiers = [] } = useQuery({
    queryKey: ['price-tiers'],
    queryFn: () => api.get<PriceTierView[]>('/price-tiers'),
  });

  const save = useMutation({
    mutationFn: () => {
      // Only rows that were added or changed are sent. Sending everything would
      // work — the server upserts — but it would also rewrite prices nobody
      // touched, and make an audit of what changed impossible to read.
      const body = {
        name: name.trim(),
        ...(sku.trim() && { sku: sku.trim() }),
        ...(categoryId && { categoryId }),
        ...(packagingTypeId && { packagingTypeId }),
        ...(basePrice !== null && { basePrice }),
        ...(seesCost && costPrice !== null && { costPrice }),
        taxRateBps,
        trackStock,
        ...(reorderPoint.trim() !== '' && {
          reorderPoint: Number(reorderPoint),
        }),
        units: units.map((unit) => ({ name: unit.name, factor: unit.factor })),
        ...(prices.some((price) => price.price !== null) && {
          prices: prices
            .filter((price) => price.price !== null)
            .map((price) => ({
              unit: price.unit,
              tierId: price.tierId,
              price: price.price as number,
            })),
        }),
      };

      return editing
        ? api.patch<ProductView>(`/products/${product.id}`, body)
        : api.post<ProductView>('/products', {
            id: crypto.randomUUID(),
            ...body,
          });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      onClose();
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not save that product.',
      ),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (name.trim() && units.length > 0) save.mutate();
  };

  const addUnit = () =>
    setUnits((current) => [
      ...current,
      { name: '', factor: 1, existing: false, isBase: false },
    ]);

  const addPrice = () =>
    setPrices((current) => [
      ...current,
      {
        unit: units[0]?.name ?? '',
        tierId: tiers.find((tier) => tier.isDefault)?.id ?? tiers[0]?.id ?? '',
        price: null,
        existing: false,
      },
    ]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="product-title"
    >
      <form
        onSubmit={submit}
        className="my-8 w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-lg"
      >
        <h2 id="product-title" className="text-lg font-semibold text-slate-900">
          {editing ? `Edit ${product.name}` : 'Add a product'}
        </h2>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="p-name">
            <Input
              id="p-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
              required
            />
          </Field>

          <Field
            label="SKU"
            htmlFor="p-sku"
            hint={editing ? undefined : 'Left blank, one is generated.'}
          >
            <Input
              id="p-sku"
              value={sku}
              onChange={(event) => setSku(event.target.value)}
            />
          </Field>

          <Field label="Category" htmlFor="p-category">
            <Select
              id="p-category"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              <option value="">None</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Packaging" htmlFor="p-packaging">
            <Select
              id="p-packaging"
              value={packagingTypeId}
              onChange={(event) => setPackagingTypeId(event.target.value)}
            >
              <option value="">None</option>
              {packagingTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Base price"
            htmlFor="p-base-price"
            hint="Tax-inclusive, for one base unit."
          >
            <MoneyInput
              id="p-base-price"
              value={basePrice}
              onChange={setBasePrice}
            />
          </Field>

          {seesCost && (
            <Field
              label="Cost price"
              htmlFor="p-cost-price"
              hint="What one base unit last cost. Never used to value stock."
            >
              <MoneyInput
                id="p-cost-price"
                value={costPrice}
                onChange={setCostPrice}
              />
            </Field>
          )}

          <Field label="VAT rate" htmlFor="p-tax">
            <Select
              id="p-tax"
              value={String(taxRateBps)}
              onChange={(event) => setTaxRateBps(Number(event.target.value))}
            >
              <option value="750">7.5%</option>
              <option value="0">Exempt</option>
            </Select>
          </Field>

          <Field
            label="Reorder point"
            htmlFor="p-reorder"
            hint="In base units. Blank for none."
          >
            <Input
              id="p-reorder"
              type="number"
              min={0}
              value={reorderPoint}
              onChange={(event) => setReorderPoint(event.target.value)}
            />
          </Field>
        </div>

        <label className="mt-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={trackStock}
            onChange={(event) => setTrackStock(event.target.checked)}
          />
          <span className="text-slate-700">
            Track stock for this product
            <span className="ml-1 text-xs text-slate-500">
              (off for a service, or anything sold without touching the ledger)
            </span>
          </span>
        </label>

        {/* -- Units ------------------------------------------------------- */}
        <section className="mt-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Units</h3>
            <Button type="button" variant="secondary" onClick={addUnit}>
              Add unit
            </Button>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Exactly one unit has a factor of 1 — that is the base, and stock is
            counted in it. Units can be added and their factor changed, but{' '}
            <strong>never removed</strong>: sales and movements point at them.
          </p>

          <div className="mt-3 space-y-2">
            {units.map((unit, index) => (
              <div key={index} className="flex items-center gap-3">
                <Input
                  aria-label={`Unit ${index + 1} name`}
                  value={unit.name}
                  disabled={unit.existing}
                  onChange={(event) =>
                    setUnits((current) =>
                      current.map((row, i) =>
                        i === index ? { ...row, name: event.target.value } : row,
                      ),
                    )
                  }
                  placeholder="carton"
                  className="flex-1"
                />
                <QuantityInput
                  label={`Unit ${index + 1} factor`}
                  min={1}
                  value={unit.factor}
                  disabled={unit.isBase}
                  onChange={(next) =>
                    setUnits((current) =>
                      current.map((row, i) =>
                        i === index ? { ...row, factor: next } : row,
                      ),
                    )
                  }
                  className="w-28"
                />
                <span className="w-24 text-xs text-slate-500">
                  {unit.isBase ? 'base unit' : `= ${unit.factor} base`}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* -- Prices ------------------------------------------------------ */}
        <section className="mt-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              Prices per unit
            </h3>
            <Button
              type="button"
              variant="secondary"
              onClick={addPrice}
              disabled={tiers.length === 0}
            >
              Add price
            </Button>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            A unit with no price here falls back to base price × factor, which
            is right for a sachet and usually wrong for a carton. Prices can be
            changed but <strong>not removed</strong> — set the right number
            instead of clearing it.
          </p>

          <div className="mt-3 space-y-2">
            {prices.length === 0 && (
              <p className="text-xs text-slate-400">
                No tier prices. Every unit will use base price × factor.
              </p>
            )}
            {prices.map((price, index) => (
              <div key={index} className="flex items-center gap-3">
                <Select
                  aria-label={`Price ${index + 1} unit`}
                  value={price.unit}
                  disabled={price.existing}
                  onChange={(event) =>
                    setPrices((current) =>
                      current.map((row, i) =>
                        i === index ? { ...row, unit: event.target.value } : row,
                      ),
                    )
                  }
                  className="flex-1"
                >
                  {units.map((unit) => (
                    <option key={unit.name} value={unit.name}>
                      {unit.name}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label={`Price ${index + 1} tier`}
                  value={price.tierId}
                  disabled={price.existing}
                  onChange={(event) =>
                    setPrices((current) =>
                      current.map((row, i) =>
                        i === index
                          ? { ...row, tierId: event.target.value }
                          : row,
                      ),
                    )
                  }
                  className="flex-1"
                >
                  {tiers.map((tier) => (
                    <option key={tier.id} value={tier.id}>
                      {tier.name}
                    </option>
                  ))}
                </Select>
                <MoneyInput
                  id={`price-${index}`}
                  aria-label={`Price ${index + 1} amount`}
                  value={price.price}
                  onChange={(value) =>
                    setPrices((current) =>
                      current.map((row, i) =>
                        i === index ? { ...row, price: value } : row,
                      ),
                    )
                  }
                  className="w-32 text-right"
                />
              </div>
            ))}
          </div>
        </section>

        {editing && product.barcodes.length > 0 && (
          <section className="mt-6">
            <h3 className="text-sm font-semibold text-slate-900">Barcodes</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {product.barcodes.map((barcode) => (
                <li
                  key={barcode.id}
                  className="flex justify-between text-slate-600"
                >
                  <span>
                    {barcode.code}
                    <span className="ml-2 text-xs text-slate-400">
                      {barcode.unit.name} · {barcode.symbology}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {editing && (
          <p className="mt-4 rounded-md bg-slate-50 p-3 text-xs text-slate-500">
            Anything not listed here is left exactly as it is. This form sends
            changes, not a replacement.
          </p>
        )}

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
            disabled={save.isPending}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={save.isPending || !name.trim() || units.length === 0}
          >
            {save.isPending
              ? 'Saving…'
              : editing
                ? 'Save changes'
                : 'Add product'}
          </Button>
        </div>
      </form>
    </div>
  );
}
