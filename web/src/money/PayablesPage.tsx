import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Money } from '../components/Money';
import { Button } from '../components/Button';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import type { components } from '../api/schema';
import { PaySupplierDialog, type SupplierPaymentDraft } from './PaySupplierDialog';

type PayablesView = components['schemas']['PayablesView'];
type SupplierPaymentView = components['schemas']['SupplierPaymentView'];

/**
 * What the business owes its vendors — the mirror of "owed to us".
 *
 * The two sides look symmetrical and are not, which is the thing to keep hold
 * of here (DECISIONS.md §16). A customer payment spreads across invoices; a
 * vendor payment settles **exactly one bill**, because vendors are paid on
 * delivery or against one specific supply. So there is no allocation control on
 * this screen, and paying a vendor starts from a bill rather than from a
 * vendor.
 */
export function PayablesPage() {
  const queryClient = useQueryClient();
  const [paying, setPaying] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ['payables'],
    queryFn: () => api.get<PayablesView>('/payables'),
  });

  const pay = useMutation({
    mutationFn: (draft: SupplierPaymentDraft) =>
      api.post<SupplierPaymentView>('/supplier-payments', {
        id: crypto.randomUUID(),
        billId: draft.billId,
        amount: draft.amount,
        method: draft.method,
        ...(draft.bankAccountId && { bankAccountId: draft.bankAccountId }),
        ...(draft.reference && { reference: draft.reference }),
        ...(draft.note && { note: draft.note }),
      }),
    onSuccess: () => {
      afterWrite(queryClient);
      setPaying(null);
      setError(null);
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError ? caught.message : 'Could not record that.',
      ),
  });

  return (
    <Page title="We owe" description="Longest owed first.">
      {data && (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <Tile label="Owed to vendors" value={<Money value={data.total} />} big />
          <Tile
            label="Vendors owed"
            value={String(data.suppliers)}
            hint={
              data.oldestDays === null
                ? undefined
                : `oldest ${data.oldestDays} days`
            }
          />
          <Tile
            label="Past the agreed date"
            value={<Money value={data.overdue} />}
            hint="Only bills that were given a date."
            tone={data.overdue > 0 ? 'warn' : undefined}
          />
        </div>
      )}

      {isPending && <p className="text-sm text-slate-500">Loading…</p>}

      {data?.bySupplier.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">
          Nothing owed to anybody.
        </div>
      )}

      <div className="space-y-3">
        {data?.bySupplier.map((group) => {
          const bills = data.bills.filter(
            (bill) => bill.supplier.id === group.supplier.id,
          );
          const open = expanded === group.supplier.id;

          return (
            <div
              key={group.supplier.id}
              className="overflow-hidden rounded-lg border border-slate-200 bg-white"
            >
              <button
                type="button"
                onClick={() =>
                  setExpanded(open ? null : group.supplier.id)
                }
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
              >
                <span>
                  <span className="font-medium text-slate-900">
                    {group.supplier.name}
                  </span>
                  {group.supplier.phone && (
                    <span className="ml-2 text-xs text-slate-500">
                      {group.supplier.phone}
                    </span>
                  )}
                  <span className="ml-2 text-xs text-slate-500">
                    {group.bills} bill{group.bills === 1 ? '' : 's'} · oldest{' '}
                    {group.oldestDays}d
                  </span>
                </span>
                <span className="font-semibold text-slate-900">
                  <Money value={group.balance} />
                </span>
              </button>

              {open && (
                <table className="w-full border-t border-slate-100 text-sm">
                  <tbody className="divide-y divide-slate-50">
                    {bills.map((bill) => (
                      <tr key={bill.id}>
                        <td className="px-4 py-2">
                          <span className="text-slate-900">
                            {bill.invoiceNumber ?? 'No invoice number'}
                          </span>
                          <span className="ml-2 text-xs text-slate-500">
                            {new Date(bill.issuedAt).toLocaleDateString('en-NG')}{' '}
                            · {bill.daysOutstanding}d
                          </span>
                          {bill.daysUntilDue !== null &&
                            bill.daysUntilDue < 0 && (
                              <span className="ml-2 text-xs text-amber-700">
                                {Math.abs(bill.daysUntilDue)}d overdue
                              </span>
                            )}
                        </td>
                        <td className="px-4 py-2 text-right text-slate-500">
                          <Money value={bill.amountDue} />
                        </td>
                        <td className="px-4 py-2 text-right font-medium">
                          <Money value={bill.balance} />
                        </td>
                        <td className="px-4 py-2 text-right">
                          <Button
                            variant="secondary"
                            onClick={() => setPaying(bill.id)}
                          >
                            Pay
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>

      {paying && (
        <PaySupplierDialog
          billId={paying}
          busy={pay.isPending}
          error={error}
          onCancel={() => {
            setPaying(null);
            setError(null);
          }}
          onConfirm={(draft) => pay.mutate(draft)}
        />
      )}
    </Page>
  );
}

function Tile({
  label,
  value,
  hint,
  big,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  big?: boolean;
  tone?: 'warn';
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div
        className={`mt-1 font-semibold ${big ? 'text-3xl' : 'text-2xl'} ${
          tone === 'warn' ? 'text-amber-700' : 'text-slate-900'
        }`}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}
