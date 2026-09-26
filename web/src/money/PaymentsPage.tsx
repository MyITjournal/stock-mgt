import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Field, Input, Select } from '../components/Field';
import { Money } from '../components/Money';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import { useAuth } from '../auth/useAuth';
import type { components } from '../api/schema';
import { RecordPaymentDialog, type PaymentDraft } from './RecordPaymentDialog';
import { VoidPaymentDialog } from './VoidPaymentDialog';

type PaymentListView = components['schemas']['PaymentListView'];
type PaymentView = components['schemas']['PaymentView'];
type CustomerView = components['schemas']['CustomerView'];

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

  const [customerId, setCustomerId] = useState('');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [method, setMethod] = useState('');
  const [showVoided, setShowVoided] = useState(true);

  const [voiding, setVoiding] = useState<PaymentView | null>(null);
  const [refunding, setRefunding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = new URLSearchParams({ order: 'desc', limit: '100' });
  if (customerId) query.set('customerId', customerId);
  // The end of the chosen day, not its midnight: somebody picking 1-7
  // September means the whole of the seventh.
  if (since) query.set('since', new Date(since).toISOString());
  if (until) query.set('until', new Date(`${until}T23:59:59.999`).toISOString());
  if (method) query.set('method', method);
  if (!showVoided) query.set('includeVoided', 'false');

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => api.get<CustomerView[]>('/customers'),
  });

  const { data, isPending } = useQuery({
    queryKey: ['payments', query.toString()],
    // `order=desc` is the browsing half of a feed that also serves delta sync.
    // It is not only about order: the sync path holds back rows newer than a
    // second, so without this a payment recorded a moment ago is missing from
    // the list that refetches right after recording it.
    queryFn: () => api.get<PaymentListView>(`/payments?${query}`),
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
      <div className="mb-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Customer" htmlFor="payment-customer">
          <Select
            id="payment-customer"
            value={customerId}
            onChange={(event) => setCustomerId(event.target.value)}
          >
            <option value="">Everyone</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {`${customer.firstName} ${customer.lastName ?? ''}`.trim()}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="From" htmlFor="payment-since">
          <Input
            id="payment-since"
            type="date"
            value={since}
            onChange={(event) => setSince(event.target.value)}
          />
        </Field>

        <Field label="To" htmlFor="payment-until">
          <Input
            id="payment-until"
            type="date"
            value={until}
            onChange={(event) => setUntil(event.target.value)}
          />
        </Field>

        <Field label="How" htmlFor="payment-method">
          <Select
            id="payment-method"
            value={method}
            onChange={(event) => setMethod(event.target.value)}
          >
            <option value="">Any method</option>
            <option value="cash">Cash</option>
            <option value="transfer">Transfer</option>
            <option value="pos">POS</option>
            <option value="cheque">Cheque</option>
          </Select>
        </Field>

        <div className="flex items-end">
          {/*
            On by default. Voided payments belong on this list — it is the
            audit trail, where a mistake and its correction both have to be
            legible — so hiding them is something you ask for while
            reconciling against a statement, not the state you find it in.
          */}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showVoided}
              onChange={(event) => setShowVoided(event.target.checked)}
            />
            <span className="text-slate-700">Show voided</span>
          </label>
        </div>
      </div>

      {/* Dates bound when the money moved, not when the row was last
          touched — so voiding a September payment today does not move it
          into today's window. */}
      <p className="mb-4 text-xs text-slate-500">
        Dates filter when the payment was taken.
      </p>

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
