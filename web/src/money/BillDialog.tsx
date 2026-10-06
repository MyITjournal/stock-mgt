import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { DialogClose } from '../components/DialogClose';
import { Button } from '../components/Button';
import { Money } from '../components/Money';
import { PaidStatus } from '../components/PaidStatus';
import { api } from '../api/client';
import type { components } from '../api/schema';
import { PaySupplierDialog } from './PaySupplierDialog';
import { usePaySupplier } from './usePaySupplier';
import { BillRebates } from './BillRebates';

type SupplierBillView = components['schemas']['SupplierBillView'];

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  transfer: 'Transfer',
  pos: 'POS',
  cheque: 'Cheque',
};

/**
 * One vendor bill, and every payment that counts against it.
 *
 * **The payments listed add up to "Paid", by construction**: the server sends
 * only the payments that count (a voided one does not — it stays on Money out,
 * struck through) and works out `paid` and `balance` from exactly those. So
 * what this shows is the check somebody wants to make: what was billed, what
 * went out against it, on which day, from which account, and what is left.
 *
 * Opened from Bills and from Money out, so a payment always leads back to
 * the bill it paid.
 *
 * **Billed − Paid − Rebate = Still owing.** A vendor rebate credited on the
 * bill is its own figure, never folded into Paid, because no money moved —
 * and it is applied or removed here (`BillRebates`).
 */
export function BillDialog({
  billId,
  onClose,
}: {
  billId: string;
  onClose: () => void;
}) {
  const [paying, setPaying] = useState<'part' | 'full' | null>(null);
  const { pay, error, clearError } = usePaySupplier(() => setPaying(null));

  const { data: bill, isPending } = useQuery({
    queryKey: ['supplier-bill', billId],
    queryFn: () => api.get<SupplierBillView>(`/supplier-bills/${billId}`),
  });

  if (paying) {
    return (
      <PaySupplierDialog
        billId={billId}
        payInFull={paying === 'full'}
        busy={pay.isPending}
        error={error}
        onCancel={() => {
          setPaying(null);
          clearError();
        }}
        onConfirm={(draft) => pay.mutate(draft)}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bill-title"
    >
      <div className="relative my-8 w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-lg">
        <DialogClose onClose={onClose} />

        {isPending || !bill ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3 pr-8">
              <div>
                <h2
                  id="bill-title"
                  className="text-lg font-semibold text-slate-900"
                >
                  {bill.supplier.name}
                </h2>
                <p className="text-sm text-slate-500">
                  {bill.invoiceNumber ?? 'No invoice number'} · billed{' '}
                  {new Date(bill.issuedAt).toLocaleDateString('en-NG')}
                  {bill.dueDate &&
                    ` · due ${new Date(bill.dueDate).toLocaleDateString('en-NG')}`}
                </p>
                {bill.goodsReceipt ? (
                  <Link
                    to={`/stock/receipts/${bill.goodsReceipt.id}`}
                    className="text-xs text-slate-500 underline underline-offset-2"
                  >
                    For the delivery of{' '}
                    {new Date(bill.goodsReceipt.receivedAt).toLocaleDateString(
                      'en-NG',
                    )}
                  </Link>
                ) : (
                  <p className="text-xs text-slate-500">
                    Owed from before Reho — no delivery behind it.
                  </p>
                )}
              </div>
              <PaidStatus balance={bill.balance} paid={bill.paid} />
            </div>

            <dl
              className={`mt-4 grid gap-3 rounded-md bg-slate-50 p-3 text-sm ${
                bill.rebated > 0 ? 'grid-cols-4' : 'grid-cols-3'
              }`}
            >
              <div>
                <dt className="text-xs text-slate-500">Billed</dt>
                <dd className="font-medium text-slate-900">
                  <Money value={bill.amountDue} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Paid</dt>
                <dd className="font-medium text-slate-900">
                  <Money value={bill.paid} />
                </dd>
              </div>
              {bill.rebated > 0 && (
                <div>
                  <dt className="text-xs text-slate-500">Rebate</dt>
                  <dd className="font-medium text-emerald-700">
                    <Money value={bill.rebated} />
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-slate-500">Still owing</dt>
                <dd className="font-semibold text-slate-900">
                  <Money value={bill.balance} />
                </dd>
              </div>
            </dl>

            <h3 className="mt-5 text-sm font-semibold text-slate-900">
              Payments against this bill
            </h3>
            {bill.payments.length === 0 ? (
              <p className="mt-1 text-sm text-slate-500">None yet.</p>
            ) : (
              <table className="mt-2 w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {bill.payments.map((payment) => (
                    <tr key={payment.id}>
                      <td className="py-1.5 text-slate-600">
                        {new Date(payment.occurredAt).toLocaleDateString(
                          'en-NG',
                        )}
                      </td>
                      <td className="py-1.5">
                        {METHOD_LABELS[payment.method] ?? payment.method}
                        {payment.bankAccount && (
                          <span className="text-xs text-slate-500">
                            {' '}
                            · {payment.bankAccount.bankName}
                          </span>
                        )}
                        {payment.reference && (
                          <span className="block text-xs text-slate-400">
                            {payment.reference}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 text-right font-medium">
                        <Money value={payment.amount} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="mt-2 text-xs text-slate-400">
              A voided payment is not listed and does not count. It stays on
              Money out, struck through.
            </p>

            <BillRebates bill={bill} />

            {bill.balance > 0 && (
              <div className="mt-6 flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setPaying('part')}>
                  Pay part
                </Button>
                <Button onClick={() => setPaying('full')}>Mark as paid</Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
