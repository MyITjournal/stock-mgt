import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Money } from '../components/Money';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import { useAuth } from '../auth/useAuth';
import type { components } from '../api/schema';
import { RecordPaymentDialog, type PaymentDraft } from './RecordPaymentDialog';
import { VoidPaymentDialog } from './VoidPaymentDialog';

type PaymentListView = components['schemas']['PaymentListView'];
type PaymentView = components['schemas']['PaymentView'];

/** Who may void a payment, or hand money back. Mirrors the server. */
const MAY_REVERSE = ['owner', 'manager', 'accountant'];

/**
 * Money received, and money handed back.
 *
 * **Voided payments stay in this list, struck through.** They are dropped from
 * every balance by `LIVE_ALLOCATIONS`, but the row is deliberately kept so the
 * mistake and its correction are both legible — this is the audit trail, and
 * hiding the error would defeat the point of keeping it (DECISIONS.md §5).
 * A statement is the other way round: it shows the customer's position, so a
 * void never appears there at all.
 */
export function PaymentsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const mayReverse = user !== null && MAY_REVERSE.includes(user.orgRole);

  const [voiding, setVoiding] = useState<PaymentView | null>(null);
  const [refunding, setRefunding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ['payments'],
    // `order=desc` is the browsing half of a feed that also serves delta sync.
    // It is not only about order: the sync path holds back rows newer than a
    // second, so without this a payment recorded a moment ago is missing from
    // the list that refetches right after recording it.
    queryFn: () => api.get<PaymentListView>('/payments?order=desc&limit=100'),
  });

  const invalidate = () => {
    afterWrite(queryClient);
  };

  const voidPayment = useMutation({
    mutationFn: (input: { id: string; reason: string }) =>
      api.post<PaymentView>(`/payments/${input.id}/void`, {
        reason: input.reason,
      }),
    onSuccess: () => {
      invalidate();
      setVoiding(null);
      setError(null);
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError ? caught.message : 'Could not void that.',
      ),
  });

  const refund = useMutation({
    mutationFn: (draft: PaymentDraft) =>
      api.post<PaymentView>('/payments', {
        id: crypto.randomUUID(),
        ...(draft.customerId && { customerId: draft.customerId }),
        amount: draft.amount,
        method: draft.method,
        ...(draft.bankAccountId && { bankAccountId: draft.bankAccountId }),
        ...(draft.reference && { reference: draft.reference }),
        ...(draft.note && { note: draft.note }),
        ...(draft.allocations.length > 0 && { allocations: draft.allocations }),
      }),
    onSuccess: () => {
      invalidate();
      setRefunding(null);
      setError(null);
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not record that.',
      ),
  });

  // Already newest-first from the server. Sorted again on `occurredAt` because
  // the feed orders by `updatedAt` — voiding a payment moves it to the top of
  // that ordering, and a shop reading a list means "when did this money move",
  // not "what changed most recently".
  const payments = [...(data?.payments ?? [])].sort(
    (a, b) =>
      new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );

  return (
    <Page title="Payments" description="Money in, and money handed back.">
      {isPending && <p className="text-sm text-slate-500">Loading…</p>}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">When</th>
              <th className="px-4 py-2 font-medium">From</th>
              <th className="px-4 py-2 font-medium">Method</th>
              <th className="px-4 py-2 font-medium">Settled</th>
              <th className="px-4 py-2 text-right font-medium">Amount</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {!isPending && payments.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No payments recorded yet.
                </td>
              </tr>
            )}

            {payments.map((payment) => {
              const voided = Boolean(payment.voidedAt);
              return (
                <tr
                  key={payment.id}
                  className={voided ? 'bg-slate-50 text-slate-400' : ''}
                >
                  <td className="px-4 py-3">
                    {new Date(payment.occurredAt).toLocaleDateString('en-NG')}
                  </td>
                  <td className="px-4 py-3">
                    {payment.customer ? (
                      <Link
                        to={`/customers/${payment.customer.id}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {[
                          payment.customer.firstName,
                          payment.customer.lastName,
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      </Link>
                    ) : (
                      'Walk-in'
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {payment.method}
                    {payment.bankAccount && (
                      <span className="ml-1 text-xs text-slate-400">
                        · {payment.bankAccount.bankName}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {payment.allocations.length === 0 ? (
                      <span className="text-slate-400">credit</span>
                    ) : (
                      payment.allocations
                        .map((allocation) => allocation.sale.number)
                        .join(', ')
                    )}
                    {payment.unallocated !== 0 &&
                      payment.allocations.length > 0 && (
                        <span className="ml-1 text-slate-400">
                          (+<Money value={payment.unallocated} /> credit)
                        </span>
                      )}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-medium ${voided ? 'line-through' : ''}`}
                  >
                    <Money value={payment.amount} signed />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {voided ? (
                      <span
                        className="text-xs text-slate-400"
                        title={payment.voidedReason ?? undefined}
                      >
                        voided
                      </span>
                    ) : (
                      mayReverse && (
                        <button
                          type="button"
                          onClick={() => setVoiding(payment)}
                          className="text-xs text-slate-500 underline underline-offset-2 hover:text-slate-800"
                        >
                          Void
                        </button>
                      )
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {voiding && (
        <VoidPaymentDialog
          payment={voiding}
          busy={voidPayment.isPending}
          error={error}
          onCancel={() => {
            setVoiding(null);
            setError(null);
          }}
          onRefundInstead={() => {
            setRefunding(voiding.customerId ?? '');
            setVoiding(null);
            setError(null);
          }}
          onConfirm={(reason) =>
            voidPayment.mutate({ id: voiding.id, reason })
          }
        />
      )}

      {refunding !== null && (
        <RecordPaymentDialog
          customerId={refunding || undefined}
          busy={refund.isPending}
          error={error}
          onCancel={() => {
            setRefunding(null);
            setError(null);
          }}
          onConfirm={(draft) => refund.mutate(draft)}
        />
      )}
    </Page>
  );
}
