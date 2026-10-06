import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../components/Button';
import { Field, MoneyInput, Select } from '../components/Field';
import { Money } from '../components/Money';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import type { components } from '../api/schema';

type SupplierBillView = components['schemas']['SupplierBillView'];
type VendorRebateView = components['schemas']['VendorRebateView'];

/** "October 2026" for a rebate's month. */
const monthOf = (iso: string) =>
  new Date(iso).toLocaleDateString('en-NG', { month: 'long', year: 'numeric' });

/**
 * The rebates on one bill: those already credited on it, and applying one.
 *
 * A vendor pays a rebate only as **credit off a later bill**, so this is where
 * it lands: the owner picks the rebate they recorded as expected, enters the
 * real figure — which may differ from what they expected — and the bill owes
 * that much less. It is not a payment: Money out never shows it. A credit put
 * on the wrong bill is removed here, and the rebate goes back to expected.
 *
 * A credit bigger than what the bill still owes is refused by the server; the
 * box starts at whichever is smaller so the usual case needs no typing.
 */
export function BillRebates({ bill }: { bill: SupplierBillView }) {
  const queryClient = useQueryClient();
  const [applying, setApplying] = useState(false);
  const [rebateId, setRebateId] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: expected = [] } = useQuery({
    queryKey: ['vendor-rebates', 'expected', bill.supplierId],
    queryFn: () =>
      api.get<VendorRebateView[]>(
        `/vendor-rebates?supplierId=${bill.supplierId}&expectedOnly=true`,
      ),
    enabled: bill.balance > 0,
  });

  const chosen = expected.find((row) => row.id === rebateId) ?? expected[0];
  // Until somebody types: what was expected, or what the bill owes if less.
  const shown =
    amount ?? (chosen ? Math.min(chosen.expectedAmount, bill.balance) : null);

  const done = () => {
    afterWrite(queryClient);
    setApplying(false);
    setAmount(null);
    setRebateId('');
    setError(null);
  };
  const failed = (caught: unknown) =>
    setError(
      caught instanceof ApiError ? caught.message : 'Could not do that.',
    );

  const credit = useMutation({
    mutationFn: () =>
      api.post<VendorRebateView>(`/vendor-rebates/${chosen.id}/credit`, {
        billId: bill.id,
        amount: shown,
      }),
    onSuccess: done,
    onError: failed,
  });

  const uncredit = useMutation({
    mutationFn: (id: string) =>
      api.post<VendorRebateView>(`/vendor-rebates/${id}/uncredit`, {}),
    onSuccess: done,
    onError: failed,
  });

  return (
    <>
      {bill.rebates.length > 0 && (
        <>
          <h3 className="mt-5 text-sm font-semibold text-slate-900">
            Rebates credited on this bill
          </h3>
          <table className="mt-2 w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {bill.rebates.map((rebate) => (
                <tr key={rebate.id}>
                  <td className="py-1.5 text-slate-700">
                    {monthOf(rebate.periodStart)} rebate
                    <span className="block text-xs text-slate-400">
                      expected <Money value={rebate.expectedAmount} />
                    </span>
                  </td>
                  <td className="py-1.5 text-right font-medium text-emerald-700">
                    Credited ✓ <Money value={rebate.creditedAmount} />
                  </td>
                  <td className="py-1.5 text-right">
                    <Button
                      variant="ghost"
                      disabled={uncredit.isPending}
                      onClick={() => uncredit.mutate(rebate.id)}
                    >
                      Remove credit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {bill.balance > 0 && expected.length > 0 && !applying && (
        <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          {bill.supplier.name} has{' '}
          {expected.length === 1 ? 'a rebate' : `${expected.length} rebates`}{' '}
          expected.{' '}
          <button
            type="button"
            className="font-medium underline"
            onClick={() => setApplying(true)}
          >
            Apply rebate to this bill
          </button>
        </p>
      )}

      {applying && chosen && (
        <div className="mt-4 rounded-md border border-slate-200 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Which rebate" htmlFor="apply-rebate">
              <Select
                id="apply-rebate"
                value={chosen.id}
                onChange={(event) => {
                  setRebateId(event.target.value);
                  setAmount(null);
                }}
              >
                {expected.map((row) => (
                  <option key={row.id} value={row.id}>
                    {monthOf(row.periodStart)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Amount credited"
              htmlFor="apply-amount"
              hint="The real figure on the vendor's bill."
            >
              <MoneyInput
                id="apply-amount"
                value={shown}
                onChange={setAmount}
              />
            </Field>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Expected <Money value={chosen.expectedAmount} />. This lowers what
            the bill owes; no money moves, so it is not a payment.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setApplying(false);
                setAmount(null);
                setError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={credit.isPending || !shown || shown <= 0}
              onClick={() => credit.mutate()}
            >
              {credit.isPending ? 'Applying…' : 'Apply rebate'}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p
          className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700"
          role="alert"
        >
          {error}
        </p>
      )}
    </>
  );
}
