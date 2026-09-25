import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Money } from '../components/Money';
import { Button } from '../components/Button';
import { api, ApiError } from '../api/client';
import type { components } from '../api/schema';
import { RecordPaymentDialog, type PaymentDraft } from './RecordPaymentDialog';

type ReceivablesView = components['schemas']['ReceivablesView'];
type PaymentView = components['schemas']['PaymentView'];

/**
 * Who owes the business money, longest first.
 *
 * **A list sorted oldest-first, not 30/60/90 buckets.** Buckets are a
 * convention borrowed from accounting packages; the question people here
 * actually ask is who has owed longest, and that is a sort (DECISIONS.md §5).
 * `oldestDays` is the column that answers it, which is why it leads rather
 * than the balance.
 *
 * Grouped per customer with the invoices behind each one, because chasing a
 * debt is a phone call to a person, not to an invoice.
 */
export function ReceivablesPage() {
  const queryClient = useQueryClient();
  const [paying, setPaying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ['receivables'],
    queryFn: () => api.get<ReceivablesView>('/receivables'),
  });

  const record = useMutation({
    mutationFn: (draft: PaymentDraft) =>
      api.post<PaymentView>('/payments', {
        id: crypto.randomUUID(),
        ...(draft.customerId && { customerId: draft.customerId }),
        amount: draft.amount,
        method: draft.method,
        ...(draft.bankAccountId && { bankAccountId: draft.bankAccountId }),
        ...(draft.reference && { reference: draft.reference }),
        ...(draft.note && { note: draft.note }),
        ...(draft.allocations.length > 0 && {
          allocations: draft.allocations,
        }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['receivables'] });
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
      void queryClient.invalidateQueries({ queryKey: ['sales'] });
      setPaying(null);
      setError(null);
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not record that payment.',
      ),
  });

  return (
    <Page
      title="Owed to us"
      description="Longest owed first."
      actions={
        <Button onClick={() => setPaying('')}>Record a payment</Button>
      }
    >
      {data && (
        <div className="mb-6 rounded-lg border border-slate-200 bg-white p-5">
          <div className="text-xs uppercase tracking-wide text-slate-500">
            Total outstanding
          </div>
          <div className="mt-1 text-3xl font-semibold text-slate-900">
            <Money value={data.totalOutstanding} />
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Money owed back to a customer is excluded rather than netted off —
            the two are different problems.
          </p>
        </div>
      )}

      {isPending && <p className="text-sm text-slate-500">Loading…</p>}

      {data?.byCustomer.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">
          Nobody owes anything.
        </div>
      )}

      <div className="space-y-3">
        {data?.byCustomer.map((group) => {
          const key = group.customer?.id ?? 'walk-in';
          const name = group.customer
            ? [group.customer.firstName, group.customer.lastName]
                .filter(Boolean)
                .join(' ')
            : 'Walk-in';
          const invoices = data.invoices.filter(
            (invoice) => (invoice.customer?.id ?? 'walk-in') === key,
          );

          return (
            <div
              key={key}
              className="overflow-hidden rounded-lg border border-slate-200 bg-white"
            >
              <button
                type="button"
                onClick={() =>
                  setExpanded((current) => (current === key ? null : key))
                }
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
              >
                <span>
                  <span className="font-medium text-slate-900">{name}</span>
                  {group.customer?.phone && (
                    <a
                      href={`tel:${group.customer.phone}`}
                      onClick={(event) => event.stopPropagation()}
                      className="ml-2 text-xs text-slate-500 underline underline-offset-2"
                    >
                      {group.customer.phone}
                    </a>
                  )}
                  <span className="ml-2 text-xs text-slate-500">
                    {group.invoices} invoice{group.invoices === 1 ? '' : 's'} ·
                    oldest {group.oldestDays}d
                  </span>
                </span>
                <span className="font-semibold text-slate-900">
                  <Money value={group.balance} signed />
                </span>
              </button>

              {expanded === key && (
                <div className="border-t border-slate-100">
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-slate-50">
                      {invoices.map((invoice) => (
                        <tr key={invoice.id}>
                          <td className="px-4 py-2">
                            <Link
                              to={`/sales/${invoice.id}`}
                              className="text-slate-900 underline-offset-2 hover:underline"
                            >
                              {invoice.number}
                            </Link>
                            <span className="ml-2 text-xs text-slate-500">
                              {new Date(invoice.occurredAt).toLocaleDateString(
                                'en-NG',
                              )}{' '}
                              · {invoice.daysOutstanding}d
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right text-slate-500">
                            <Money value={invoice.total} />
                          </td>
                          <td className="px-4 py-2 text-right font-medium">
                            <Money value={invoice.balance} signed />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {group.customer && (
                    <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-2">
                      <Link
                        to={`/customers/${group.customer.id}`}
                        className="text-xs text-slate-500 underline underline-offset-2"
                      >
                        Statement
                      </Link>
                      <button
                        type="button"
                        onClick={() => setPaying(group.customer!.id)}
                        className="text-xs font-medium text-slate-900 underline underline-offset-2"
                      >
                        Record a payment
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {paying !== null && (
        <RecordPaymentDialog
          customerId={paying || undefined}
          busy={record.isPending}
          error={error}
          onCancel={() => {
            setPaying(null);
            setError(null);
          }}
          onConfirm={(draft) => record.mutate(draft)}
        />
      )}
    </Page>
  );
}
