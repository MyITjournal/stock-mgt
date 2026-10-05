import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DialogClose } from '../components/DialogClose';
import { Button } from '../components/Button';
import { Field, Input, MoneyInput, Select } from '../components/Field';
import { Money } from '../components/Money';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import type { components } from '../api/schema';

type VendorRebateView = components['schemas']['VendorRebateView'];
type SupplierView = components['schemas']['SupplierView'];
type PurchaseTargetWithProgress =
  components['schemas']['PurchaseTargetWithProgress'];

/**
 * The month's vendor rebates, under its targets.
 *
 * **Recorded here, credited on a bill.** When a vendor's scheme for the month
 * is met, the owner records what they expect — tentative, because the vendor
 * works out the real figure later. When the credit lands on a later bill it is
 * applied there (Bills → open the bill → Apply rebate), and the row here turns
 * **Credited ✓**.
 *
 * **Targets are shown beside it, not checked.** Whether a scheme was met is the
 * owner's judgement — schemes differ by vendor — so "2 of 3 targets met" is
 * context for the decision, never a rule that refuses it.
 */
export function RebatesPanel({
  month,
  supplierId,
  targets,
  canEdit,
}: {
  /** `YYYY-MM`, as the Targets page holds it. */
  month: string;
  supplierId: string;
  targets: readonly PurchaseTargetWithProgress[];
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const period = new Date(`${month}-01T12:00:00.000Z`).toISOString();
  const query = new URLSearchParams({ period });
  if (supplierId) query.set('supplierId', supplierId);

  const { data: rebates = [] } = useQuery({
    queryKey: ['vendor-rebates', query.toString()],
    queryFn: () => api.get<VendorRebateView[]>(`/vendor-rebates?${query}`),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/vendor-rebates/${id}`),
    onSuccess: () => {
      afterWrite(queryClient);
      setError(null);
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError ? caught.message : 'Could not remove that.',
      ),
  });

  /** "2 of 3 met" for a vendor this month — counted, for context only. */
  const metFor = (id: string) => {
    const theirs = targets.filter((target) => target.supplierId === id);
    if (theirs.length === 0) return null;
    const met = theirs.filter((t) => t.progress.achievedBps >= 10_000).length;
    return `${met} of ${theirs.length} target${theirs.length === 1 ? '' : 's'} met`;
  };

  return (
    <section className="mt-8">
      <div className="mb-2 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Rebates this month
          </h2>
          <p className="text-xs text-slate-500">
            What a vendor will credit off a later bill for this month’s buying.
            Not a payment, not an expense.
          </p>
        </div>
        {canEdit && (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            Record expected rebate
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

      {rebates.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          No rebates recorded for this month.
        </p>
      ) : (
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {rebates.map((rebate) => {
            const met = metFor(rebate.supplier.id);
            return (
              <div
                key={rebate.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <div>
                  <div className="font-medium text-slate-900">
                    {rebate.supplier.name}
                  </div>
                  <div className="text-xs text-slate-500">
                    {[met, rebate.note].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="text-right">
                  {rebate.status === 'credited' ? (
                    <>
                      <div className="font-medium text-emerald-700">
                        Credited ✓ <Money value={rebate.creditedAmount} />
                      </div>
                      <div className="text-xs text-slate-500">
                        off bill{' '}
                        {rebate.bill?.invoiceNumber ?? 'with no number'}
                        {rebate.creditedAt &&
                          `, ${new Date(rebate.creditedAt).toLocaleDateString('en-NG')}`}
                        {' · '}expected <Money value={rebate.expectedAmount} />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="font-medium text-amber-800">
                        Expected <Money value={rebate.expectedAmount} />
                      </div>
                      <div className="text-xs text-slate-500">
                        Apply it on the vendor’s next bill, under Bills.
                      </div>
                    </>
                  )}
                </div>
                {canEdit && rebate.status === 'expected' && (
                  <Button
                    variant="ghost"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(rebate.id)}
                  >
                    Remove
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {adding && (
        <RecordRebateDialog
          period={period}
          supplierId={supplierId}
          onClose={() => setAdding(false)}
        />
      )}
    </section>
  );
}

function RecordRebateDialog({
  period,
  supplierId: initialSupplier,
  onClose,
}: {
  period: string;
  supplierId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [supplierId, setSupplierId] = useState(initialSupplier);
  const [amount, setAmount] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api.get<SupplierView[]>('/suppliers'),
  });

  const save = useMutation({
    mutationFn: () =>
      api.post<VendorRebateView>('/vendor-rebates', {
        id: crypto.randomUUID(),
        supplierId,
        period,
        expectedAmount: amount,
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
      aria-labelledby="rebate-title"
    >
      <form
        onSubmit={submit}
        className="relative w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-lg"
      >
        <DialogClose onClose={onClose} />
        <h2 id="rebate-title" className="text-lg font-semibold text-slate-900">
          Record expected rebate
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          A rough figure is fine — the real one is entered when the credit lands
          on a bill.
        </p>

        <div className="mt-4 space-y-4">
          <Field label="Vendor" htmlFor="rebate-supplier">
            <Select
              id="rebate-supplier"
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
          <Field label="Rebate you expect" htmlFor="rebate-amount">
            <MoneyInput
              id="rebate-amount"
              value={amount}
              onChange={setAmount}
            />
          </Field>
          <Field label="Note" htmlFor="rebate-note">
            <Input
              id="rebate-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Met the lotion target."
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
            {save.isPending ? 'Saving…' : 'Record'}
          </Button>
        </div>
      </form>
    </div>
  );
}
