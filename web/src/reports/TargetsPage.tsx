import { useState, type FormEvent } from 'react';
import { DialogClose } from '../components/DialogClose';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Button } from '../components/Button';
import { Field, Input, Select } from '../components/Field';
import { QuantityInput } from '../components/QuantityInput';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import { useIsManager } from '../auth/useAuth';
import { formatCartons } from '../lib/quantity';
import { RebatesPanel } from './RebatesPanel';
import { MoneyTargets } from './MoneyTargets';
import type { components } from '../api/schema';

type PurchaseTargetReportView =
  components['schemas']['PurchaseTargetReportView'];
type PurchaseTargetWithProgress =
  components['schemas']['PurchaseTargetWithProgress'];
type PurchaseTargetView = components['schemas']['PurchaseTargetView'];
type SupplierView = components['schemas']['SupplierView'];
type CategoryView = components['schemas']['CategoryView'];

/**
 * What each vendor expects bought this month, in cartons of a category.
 *
 * **A target is a category and a number of cartons** (DECISIONS.md §12,
 * 2026-10-04) — "112 cartons of lotion" — and any product filed under the
 * category counts. That is how the vendors count: they deal in cartons, never
 * pieces, and what to buy within the category is the shop's decision, made
 * from stock and customers. So there is no product, no unit and no money here.
 *
 * **Each product's carton is its biggest unit.** A carton of 12 and a carton of
 * 24 each count as one. A product with nothing bigger than its base unit has no
 * carton, and is named on the target so a low number explains itself.
 *
 * Editing changes the number and the note only. The vendor, category and month
 * are what the target *is*; changing them would quietly restate what a past
 * month meant, so the way to change those is to remove it and set another.
 */
export function TargetsPage() {
  const [params, setParams] = useSearchParams();
  const isManager = useIsManager();
  const [dialog, setDialog] = useState<
    { mode: 'add' } | { mode: 'edit'; target: PurchaseTargetView } | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Its own month rather than the shared period: a target is a calendar month
  // by definition, so "last 7 days" is not a question it has an answer to.
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
      afterWrite(queryClient);
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
      description="How many cartons of each category your vendors expect this month, and how far along you are."
      actions={
        isManager ? (
          <Button onClick={() => setDialog({ mode: 'add' })}>
            Set a target
          </Button>
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

        <p className="ml-auto text-xs text-slate-500">
          Counted in cartons from deliveries that arrived and were paid for.
        </p>
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

      {data && (
        <MoneyTargets
          month={month}
          supplierId={supplierId}
          targets={data.moneyTargets}
          canEdit={isManager}
        />
      )}

      {data && data.targets.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">
          No carton targets for this month. Set one when a vendor agrees a
          scheme — a category and a number of cartons.
        </div>
      )}

      <div className="space-y-3">
        {data?.targets.map((target) => (
          <TargetCard
            key={target.id}
            target={target}
            canEdit={isManager}
            onEdit={() => setDialog({ mode: 'edit', target })}
            onRemove={() => remove.mutate(target.id)}
            removing={remove.isPending}
          />
        ))}
      </div>

      <RebatesPanel
        month={month}
        supplierId={supplierId}
        targets={data?.targets ?? []}
        moneyTargets={data?.moneyTargets ?? []}
        canEdit={isManager}
      />

      {dialog && (
        <TargetDialog
          month={month}
          editing={dialog.mode === 'edit' ? dialog.target : null}
          onClose={() => setDialog(null)}
        />
      )}
    </Page>
  );
}

function TargetCard({
  target,
  canEdit,
  onEdit,
  onRemove,
  removing,
}: {
  target: PurchaseTargetWithProgress;
  canEdit: boolean;
  onEdit: () => void;
  onRemove: () => void;
  removing: boolean;
}) {
  const { progress } = target;
  const met = progress.achievedBps >= 10_000;
  const percent = Math.min(progress.achievedBps / 100, 100);

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-medium text-slate-900">{target.category.name}</h2>
          <p className="text-xs text-slate-500">{target.supplier.name}</p>
        </div>

        <div className="text-right">
          <div
            className={`text-lg font-semibold ${met ? 'text-brand-700' : 'text-slate-900'}`}
          >
            {Math.round(progress.achievedBps / 100)}%
          </div>
          <div className="text-xs text-slate-500">
            {formatCartons(progress.achievedCartons)} of{' '}
            {formatCartons(progress.targetCartons)} cartons
          </div>
        </div>
      </div>

      {/* The same ramp as the dashboard ring: a lighter green track, so the
          bar reads as one scale whether it is nearly empty or full. */}
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-brand-100">
        <div
          className="h-full rounded-full bg-brand-600"
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-6 text-sm">
        <div>
          <div className="text-xs uppercase text-slate-500">Still to buy</div>
          <div className="text-slate-900">
            {met
              ? 'Target met'
              : `${formatCartons(progress.remainingCartons)} cartons`}
          </div>
        </div>

        {target.note && (
          <div className="flex-1">
            <div className="text-xs uppercase text-slate-500">Note</div>
            <div className="text-slate-600">{target.note}</div>
          </div>
        )}

        {canEdit && (
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={onEdit}>
              Edit
            </Button>
            <Button variant="ghost" onClick={onRemove} disabled={removing}>
              Remove
            </Button>
          </div>
        )}
      </div>

      {progress.productsWithoutCarton.length > 0 && (
        <p className="mt-3 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
          Not counted — no carton set up:{' '}
          {progress.productsWithoutCarton
            .map((product) => product.name)
            .join(', ')}
          . Give {progress.productsWithoutCarton.length === 1 ? 'it' : 'them'} a
          carton unit on the product to count{' '}
          {progress.productsWithoutCarton.length === 1 ? 'its' : 'their'}{' '}
          deliveries.
        </p>
      )}
    </article>
  );
}

/**
 * Adding a target, or editing one. Editing shows the vendor, category and
 * month without letting them change, so the person can see what they are
 * editing without being able to turn it into a different target.
 */
function TargetDialog({
  month,
  editing,
  onClose,
}: {
  month: string;
  editing: PurchaseTargetView | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [supplierId, setSupplierId] = useState(editing?.supplierId ?? '');
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? '');
  const [targetMonth, setTargetMonth] = useState(
    editing ? editing.periodStart.slice(0, 7) : month,
  );
  const [cartons, setCartons] = useState<number>(editing?.targetCartons ?? 0);
  const [note, setNote] = useState(editing?.note ?? '');
  const [error, setError] = useState<string | null>(null);

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api.get<SupplierView[]>('/suppliers'),
    enabled: !editing,
  });
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<CategoryView[]>('/categories'),
    enabled: !editing,
  });

  const save = useMutation({
    mutationFn: () =>
      editing
        ? api.patch<PurchaseTargetView>(`/purchase-targets/${editing.id}`, {
            targetCartons: cartons,
            // '' clears a note; the server reads an empty string as "none".
            note: note.trim(),
          })
        : api.post<PurchaseTargetView>('/purchase-targets', {
            id: crypto.randomUUID(),
            supplierId,
            categoryId,
            period: new Date(`${targetMonth}-01T12:00:00.000Z`).toISOString(),
            targetCartons: cartons,
            ...(note.trim() && { note: note.trim() }),
          }),
    onSuccess: () => {
      afterWrite(queryClient);
      onClose();
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not save that target.',
      ),
  });

  const ready =
    cartons >= 1 &&
    (editing ? true : Boolean(supplierId && categoryId && targetMonth));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (ready) save.mutate();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="target-title"
    >
      <form
        onSubmit={submit}
        className="relative my-8 w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-lg"
      >
        <DialogClose onClose={onClose} />
        <h2 id="target-title" className="text-lg font-semibold text-slate-900">
          {editing ? 'Edit target' : 'Set a target'}
        </h2>

        <div className="mt-5 space-y-4">
          {editing ? (
            <dl className="grid grid-cols-3 gap-2 rounded-md bg-slate-50 p-3 text-sm">
              <div>
                <dt className="text-xs uppercase text-slate-500">Vendor</dt>
                <dd className="text-slate-900">{editing.supplier.name}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-slate-500">Category</dt>
                <dd className="text-slate-900">{editing.category.name}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-slate-500">Month</dt>
                <dd className="text-slate-900">
                  {editing.periodStart.slice(0, 7)}
                </dd>
              </div>
            </dl>
          ) : (
            <>
              <Field label="Vendor" htmlFor="new-target-supplier">
                <Select
                  id="new-target-supplier"
                  value={supplierId}
                  onChange={(event) => setSupplierId(event.target.value)}
                >
                  <option value="">Choose a vendor</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label="Category"
                htmlFor="new-target-category"
                hint="Every product filed under it counts."
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

              <Field label="Month" htmlFor="new-target-month">
                <Input
                  id="new-target-month"
                  type="month"
                  value={targetMonth}
                  onChange={(event) => setTargetMonth(event.target.value)}
                />
              </Field>
            </>
          )}

          <Field
            label="Cartons"
            htmlFor="target-cartons"
            hint="Each product's biggest unit counts as one carton, whatever it holds."
          >
            <QuantityInput
              id="target-cartons"
              label="Cartons"
              min={1}
              value={cartons}
              onChange={setCartons}
              className="w-40"
            />
          </Field>

          <Field
            label="Note"
            htmlFor="target-note"
            hint="Optional — the scheme's terms, a promo."
          >
            <Input
              id="target-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="One free carton in every twenty"
            />
          </Field>
        </div>

        {error && (
          <p
            className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700"
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
          <Button type="submit" disabled={save.isPending || !ready}>
            {save.isPending
              ? 'Saving…'
              : editing
                ? 'Save changes'
                : 'Set target'}
          </Button>
        </div>
      </form>
    </div>
  );
}
