import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Money } from '../components/Money';
import { Button } from '../components/Button';
import { Field, Input, MoneyInput, Select } from '../components/Field';
import { api, ApiError } from '../api/client';
import { useIsManager } from '../auth/useAuth';
import type { components } from '../api/schema';

type PurchaseTargetReportView =
  components['schemas']['PurchaseTargetReportView'];
type PurchaseTargetWithProgress =
  components['schemas']['PurchaseTargetWithProgress'];
type PurchaseTargetView = components['schemas']['PurchaseTargetView'];
type SupplierView = components['schemas']['SupplierView'];
type CategoryView = components['schemas']['CategoryView'];
type ProductView = components['schemas']['ProductView'];

/** The month picker works in months, because vendor schemes do. */
function monthValue(iso: string): string {
  return iso.slice(0, 7);
}

/**
 * Vendor purchase targets, and how much of each has actually landed.
 *
 * Four ways of counting here are decisions rather than details, and each would
 * be got wrong by a reasonable implementation (DECISIONS.md §12):
 *
 * - **Progress counts goods received, not ordered.** An order the vendor has
 *   not delivered is exactly what still needs chasing, so it stays in
 *   "remaining" — which is also why there are no purchase orders in this
 *   product at all.
 * - **Quantity comes from what was paid for.** "Buy 19, get 1 free" advances a
 *   quota by 19: the free case is real stock and counts for valuation, just not
 *   against the scheme.
 * - **Value is the invoice total**, never a rounded per-unit cost.
 * - **A category target counts only the products in it that carry no target of
 *   their own**, or the same carton advances two rows and the vendor's sheet
 *   disagrees with this one.
 *
 * `targetValue` is a buying price, which is why these routes are closed to a
 * rep outright rather than redacted — and why targets are not on the home
 * screen.
 */
export function TargetsPage() {
  const [params, setParams] = useSearchParams();
  const isManager = useIsManager();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Deliberately its own month rather than the shared period: a target is a
  // calendar month by definition, so "last 7 days" is not a question it has an
  // answer to.
  const month = params.get('month') ?? new Date().toISOString().slice(0, 7);
  const supplierId = params.get('supplierId') ?? '';

  const search = new URLSearchParams({
    period: new Date(`${month}-01T00:00:00.000Z`).toISOString(),
  });
  if (supplierId) search.set('supplierId', supplierId);

  const { data, isPending } = useQuery({
    queryKey: ['purchase-targets', 'report', search.toString()],
    queryFn: () =>
      api.get<PurchaseTargetReportView>(`/purchase-targets/report?${search}`),
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api.get<SupplierView[]>('/suppliers'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/purchase-targets/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['purchase-targets'] });
      setError(null);
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not remove that target.',
      ),
  });

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };

  return (
    <Page
      title="Purchase targets"
      description="What each vendor expects you to buy this month, and how far along you are."
      actions={
        isManager ? (
          <Button onClick={() => setAdding(true)}>Set a target</Button>
        ) : undefined
      }
    >
      <div className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <Field label="Month" htmlFor="target-month">
          <Input
            id="target-month"
            type="month"
            value={month}
            onChange={(event) => setParam('month', event.target.value)}
          />
        </Field>

        <Field label="Vendor" htmlFor="target-supplier">
          <Select
            id="target-supplier"
            value={supplierId}
            onChange={(event) => setParam('supplierId', event.target.value)}
          >
            <option value="">Everyone</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </Select>
        </Field>

        {data && (
          <p className="ml-auto text-xs text-slate-500">
            {monthValue(data.periodStart)} · counted from deliveries that
            arrived
          </p>
        )}
      </div>

      {error && (
        <p
          className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700"
          role="alert"
        >
          {error}
        </p>
      )}

      {isPending && <p className="text-sm text-slate-500">Loading…</p>}

      {data && data.targets.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">
          No targets for this month. Most months have none, which is not a
          problem — set one when a vendor agrees a scheme.
        </div>
      )}

      <div className="space-y-3">
        {data?.targets.map((target) => (
          <TargetCard
            key={target.id}
            target={target}
            canEdit={isManager}
            onRemove={() => remove.mutate(target.id)}
            removing={remove.isPending}
          />
        ))}
      </div>

      {adding && <TargetDialog onClose={() => setAdding(false)} />}
    </Page>
  );
}

function TargetCard({
  target,
  canEdit,
  onRemove,
  removing,
}: {
  target: PurchaseTargetWithProgress;
  canEdit: boolean;
  onRemove: () => void;
  removing: boolean;
}) {
  const { progress } = target;
  const met = progress.achievedBps >= 10_000;
  const percent = Math.min(progress.achievedBps / 100, 100);

  // Quoted in what the owner typed it in: "110 cartons" reads back as cartons
  // even though the ledger stores pieces.
  const unit = target.displayUnit;
  const inUnit = (base: number) =>
    unit && target.unitFactor > 1
      ? `${Math.round((base / target.unitFactor) * 10) / 10} ${unit.name.toLowerCase()}`
      : `${base}`;

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-medium text-slate-900">
            {target.supplier.name}
          </h2>
          <p className="text-xs text-slate-500">
            {target.product
              ? `${target.product.name} · ${target.product.sku}`
              : (target.category?.name ?? 'Everything')}
            {target.category && ' — only products with no target of their own'}
          </p>
        </div>

        <div className="text-right">
          <div
            className={`text-lg font-semibold ${met ? 'text-emerald-700' : 'text-slate-900'}`}
          >
            {(progress.achievedBps / 100).toFixed(0)}%
          </div>
          <div className="text-xs text-slate-500">
            {inUnit(progress.achievedQuantity)} of{' '}
            {inUnit(progress.targetQuantity)}
          </div>
        </div>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full ${met ? 'bg-emerald-500' : 'bg-slate-900'}`}
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-6 text-sm">
        <div>
          <div className="text-xs uppercase text-slate-500">Still to buy</div>
          <div className="text-slate-900">
            {inUnit(progress.remainingQuantity)}
          </div>
        </div>

        <div>
          <div className="text-xs uppercase text-slate-500">Spent</div>
          <div className="text-slate-900">
            <Money value={progress.achievedValue} />
          </div>
        </div>

        {progress.targetValue !== null && (
          <div>
            <div className="text-xs uppercase text-slate-500">Value quota</div>
            <div className="text-slate-900">
              <Money value={progress.targetValue} />
              {progress.remainingValue !== null && (
                <span className="ml-2 text-xs text-slate-500">
                  <Money value={progress.remainingValue} /> to go
                </span>
              )}
            </div>
          </div>
        )}

        {target.note && (
          <div className="flex-1">
            <div className="text-xs uppercase text-slate-500">Note</div>
            <div className="text-slate-600">{target.note}</div>
          </div>
        )}

        {canEdit && (
          <Button
            variant="ghost"
            className="ml-auto"
            onClick={onRemove}
            disabled={removing}
          >
            Remove
          </Button>
        )}
      </div>
    </article>
  );
}

function TargetDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [supplierId, setSupplierId] = useState('');
  const [scope, setScope] = useState<'category' | 'product'>('category');
  const [categoryId, setCategoryId] = useState('');
  const [productId, setProductId] = useState('');
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [quantity, setQuantity] = useState('');
  const [unitId, setUnitId] = useState('');
  const [targetValue, setTargetValue] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api.get<SupplierView[]>('/suppliers'),
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<CategoryView[]>('/categories'),
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products', ''],
    queryFn: () => api.get<ProductView[]>('/products'),
  });

  const chosenProduct = products.find((product) => product.id === productId);

  const create = useMutation({
    mutationFn: () =>
      api.post<PurchaseTargetView>('/purchase-targets', {
        id: crypto.randomUUID(),
        supplierId,
        ...(scope === 'category' ? { categoryId } : { productId }),
        period: new Date(`${month}-01T00:00:00.000Z`).toISOString(),
        targetQuantity: Number(quantity),
        ...(scope === 'product' && unitId ? { unitId } : {}),
        ...(targetValue !== null ? { targetValue } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['purchase-targets'] });
      onClose();
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not set that target.',
      ),
  });

  const ready =
    Boolean(supplierId) &&
    Boolean(scope === 'category' ? categoryId : productId) &&
    Number(quantity) > 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (ready) create.mutate();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="target-title"
    >
      <form
        onSubmit={submit}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-lg"
      >
        <h2 id="target-title" className="text-lg font-semibold text-slate-900">
          Set a purchase target
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          A quota a vendor has agreed with you, for one calendar month.
        </p>

        <div className="mt-4 space-y-4">
          <Field label="Vendor" htmlFor="new-target-supplier">
            <Select
              id="new-target-supplier"
              value={supplierId}
              onChange={(event) => setSupplierId(event.target.value)}
              required
            >
              <option value="">Choose a vendor</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-2">
            {(['category', 'product'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setScope(option)}
                className={`rounded-md border px-3 py-2 text-sm transition ${
                  scope === option
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {option === 'category' ? 'A whole category' : 'One product'}
              </button>
            ))}
          </div>

          {scope === 'category' ? (
            <Field
              label="Category"
              htmlFor="new-target-category"
              hint="Counts only the products in it that carry no target of their own."
            >
              <Select
                id="new-target-category"
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
              >
                <option value="">Choose a category</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field label="Product" htmlFor="new-target-product">
              <Select
                id="new-target-product"
                value={productId}
                onChange={(event) => {
                  setProductId(event.target.value);
                  setUnitId('');
                }}
              >
                <option value="">Choose a product</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field
            label="Month"
            htmlFor="new-target-month"
            hint="Vendor schemes run on calendar months."
          >
            <Input
              id="new-target-month"
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              required
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity" htmlFor="new-target-quantity">
              <Input
                id="new-target-quantity"
                inputMode="numeric"
                value={quantity}
                onChange={(event) =>
                  setQuantity(event.target.value.replace(/[^\d]/g, ''))
                }
                placeholder="110"
                required
              />
            </Field>

            {scope === 'product' && (
              <Field label="Counted in" htmlFor="new-target-unit">
                <Select
                  id="new-target-unit"
                  value={unitId}
                  onChange={(event) => setUnitId(event.target.value)}
                  disabled={!chosenProduct}
                >
                  <option value="">Base unit</option>
                  {chosenProduct?.units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name}
                      {unit.factor === 1 ? '' : ` (${unit.factor})`}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>

          <Field
            label="Value quota"
            htmlFor="new-target-value"
            hint="Optional, for schemes written in money rather than cases."
          >
            <MoneyInput
              id="new-target-value"
              value={targetValue}
              onChange={setTargetValue}
              placeholder="0.00"
            />
          </Field>

          <Field label="Note" htmlFor="new-target-note">
            <Input
              id="new-target-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Q4 scheme, 3% rebate at 110 cartons."
            />
          </Field>

          <p className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">
            Progress counts goods <strong>received</strong>, not ordered, and
            quantity comes from what the invoice <strong>charged for</strong> —
            so "buy 19, get 1 free" advances this by 19.
          </p>
        </div>

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
            disabled={create.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending || !ready}>
            {create.isPending ? 'Saving…' : 'Set target'}
          </Button>
        </div>
      </form>
    </div>
  );
}
