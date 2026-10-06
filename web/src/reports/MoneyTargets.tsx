import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DialogClose } from '../components/DialogClose';
import { Button } from '../components/Button';
import { Field, Input, MoneyInput, Select } from '../components/Field';
import { MoneyTargetRing } from '../components/TargetRing';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import type { components } from '../api/schema';

type MoneyTargetWithProgress = components['schemas']['MoneyTargetWithProgress'];
type SupplierView = components['schemas']['SupplierView'];

/**
 * Each vendor's month in money — "₦12M this month" — above the carton targets.
 *
 * One figure per vendor per month, counted from the invoice value of the goods
 * that arrived. **Whether the vendor adds VAT is a choice on the target**,
 * because not every vendor does: when they do, the target is before VAT and
 * the server takes VAT off the month's invoices before counting, so ₦12.9M of
 * invoices meets ₦12M. The figures shown are the server's.
 */
export function MoneyTargets({
  month,
  supplierId,
  targets,
  canEdit,
}: {
  /** `YYYY-MM`. */
  month: string;
  supplierId: string;
  targets: readonly MoneyTargetWithProgress[];
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<
    { mode: 'add' } | { mode: 'edit'; target: MoneyTargetWithProgress } | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) =>
      api.delete<void>(`/purchase-targets/money/${id}`),
    onSuccess: () => {
      afterWrite(queryClient);
      setError(null);
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError ? caught.message : 'Could not remove that.',
      ),
  });

  if (targets.length === 0 && !canEdit) return null;

  return (
    <section className="mb-8">
      <div className="mb-2 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Money targets this month
          </h2>
          <p className="text-xs text-slate-500">
            What each vendor expects bought from them, counted from the invoices
            of what arrived.
          </p>
        </div>
        {canEdit && (
          <Button
            variant="secondary"
            onClick={() => setDialog({ mode: 'add' })}
          >
            Set a money target
          </Button>
        )}
      </div>

      {error && (
        <p
          className="mb-2 rounded-md bg-red-50 p-3 text-sm text-red-700"
          role="alert"
        >
          {error}
        </p>
      )}

      {targets.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          No money targets for this month.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
          {targets.map((target) => (
            <div key={target.id}>
              <MoneyTargetRing {...target} supplier={target.supplier.name} />
              {canEdit && (
                <div className="mt-1 flex justify-center gap-1">
                  <Button
                    variant="ghost"
                    onClick={() => setDialog({ mode: 'edit', target })}
                  >
                    Change
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(target.id)}
                  >
                    Remove
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {dialog && (
        <MoneyTargetDialog
          month={month}
          supplierId={supplierId}
          editing={dialog.mode === 'edit' ? dialog.target : null}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}

function MoneyTargetDialog({
  month,
  supplierId: initialSupplier,
  editing,
  onClose,
}: {
  month: string;
  supplierId: string;
  editing: MoneyTargetWithProgress | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [supplierId, setSupplierId] = useState(
    editing?.supplier.id ?? initialSupplier,
  );
  const [amount, setAmount] = useState<number | null>(editing?.amount ?? null);
  const [addsVat, setAddsVat] = useState(editing?.addsVat ?? true);
  const [note, setNote] = useState(editing?.note ?? '');
  const [error, setError] = useState<string | null>(null);

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api.get<SupplierView[]>('/suppliers'),
  });

  const save = useMutation({
    mutationFn: () =>
      editing
        ? api.patch(`/purchase-targets/money/${editing.id}`, {
            amount,
            addsVat,
            note: note.trim(),
          })
        : api.post('/purchase-targets/money', {
            id: crypto.randomUUID(),
            supplierId,
            // Noon on the 1st: the same calendar month in every zone; the
            // server snaps it to the 1st in the shop's own timezone.
            period: new Date(`${month}-01T12:00:00.000Z`).toISOString(),
            amount,
            addsVat,
            ...(note.trim() && { note: note.trim() }),
          }),
    onSuccess: () => {
      afterWrite(queryClient);
      onClose();
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError ? caught.message : 'Could not save that.',
      ),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (supplierId && amount && amount > 0) save.mutate();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="money-target-title"
    >
      <form
        onSubmit={submit}
        className="relative w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-lg"
      >
        <DialogClose onClose={onClose} />
        <h2
          id="money-target-title"
          className="text-lg font-semibold text-slate-900"
        >
          {editing
            ? `Money target · ${editing.supplier.name}`
            : 'Set a money target'}
        </h2>

        <div className="mt-4 space-y-4">
          {!editing && (
            <Field label="Vendor" htmlFor="money-target-supplier">
              <Select
                id="money-target-supplier"
                value={supplierId}
                onChange={(event) => setSupplierId(event.target.value)}
                required
              >
                <option value="">Choose a vendor…</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field label="Target for the month" htmlFor="money-target-amount">
            <MoneyInput
              id="money-target-amount"
              value={amount}
              onChange={setAmount}
            />
          </Field>

          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={addsVat}
              onChange={(event) => setAddsVat(event.target.checked)}
            />
            <span>
              This vendor adds 7.5% VAT on top of their invoices
              <span className="block text-xs text-slate-500">
                {addsVat
                  ? 'The target is before VAT; invoices count without their VAT.'
                  : 'Invoices count in full.'}
              </span>
            </span>
          </label>

          <Field label="Note" htmlFor="money-target-note">
            <Input
              id="money-target-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
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
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={save.isPending || !supplierId || !amount || amount <= 0}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </div>
  );
}
