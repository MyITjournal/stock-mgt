import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Money } from '../components/Money';
import { Button } from '../components/Button';
import { Field, Input, Select } from '../components/Field';
import { DataTable, type Column } from '../components/DataTable';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import type { components } from '../api/schema';

type SupplierPaymentListView =
  components['schemas']['SupplierPaymentListView'];
type SupplierPaymentView = components['schemas']['SupplierPaymentView'];
type SupplierView = components['schemas']['SupplierView'];

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  transfer: 'Transfer',
  pos: 'POS',
  cheque: 'Cheque',
};

/**
 * What has been paid out to vendors.
 *
 * **This screen exists because voiding needed somewhere to happen.** A void is
 * the *only* correction on this side — there are no negative payments
 * (DECISIONS.md §16) — and a mis-keyed payment makes its bill look settled, so
 * the bill drops straight off `GET /payables`. Without a list of payments
 * there was no way to reach the mistake at all: the money was recorded, the
 * debt looked cleared, and nothing on screen could undo it.
 *
 * Read newest-first, which skips the one-second sync lag, so a payment
 * recorded a moment ago is here rather than missing for a second (§8).
 *
 * **Voided payments stay on this list.** It is the audit trail, where the
 * mistake and its correction both have to be legible — the same rule the
 * customer-side feed follows. What they drop off is the vendor's position.
 */
export function SupplierPaymentsPage() {
  const queryClient = useQueryClient();
  const [supplierId, setSupplierId] = useState('');
  const [voiding, setVoiding] = useState<SupplierPaymentView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = new URLSearchParams({ order: 'desc', limit: '100' });
  if (supplierId) query.set('supplierId', supplierId);

  const { data, isPending } = useQuery({
    queryKey: ['supplier-payments', query.toString()],
    queryFn: () =>
      api.get<SupplierPaymentListView>(`/supplier-payments?${query}`),
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api.get<SupplierView[]>('/suppliers'),
  });

  const voidPayment = useMutation({
    mutationFn: (input: { id: string; reason: string }) =>
      api.post<SupplierPaymentView>(
        `/supplier-payments/${input.id}/void`,
        { reason: input.reason },
      ),
    onSuccess: () => {
      afterWrite(queryClient);
      setVoiding(null);
      setError(null);
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not void that payment.',
      ),
  });

  const columns: readonly Column<SupplierPaymentView>[] = [
    {
      header: 'When',
      cell: (row) => (
        <span className="whitespace-nowrap text-slate-600">
          {new Date(row.occurredAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      header: 'Vendor',
      cell: (row) => (
        <span className="font-medium text-slate-900">{row.supplier.name}</span>
      ),
    },
    {
      header: 'Against',
      cell: (row) => (
        <span>
          {row.bill.invoiceNumber ?? (
            <span className="text-slate-400">no invoice number</span>
          )}
          <span className="block text-xs text-slate-500">
            {new Date(row.bill.issuedAt).toLocaleDateString()}
          </span>
        </span>
      ),
    },
    {
      header: 'How',
      cell: (row) => (
        <span>
          {METHOD_LABELS[row.method] ?? row.method}
          {row.bankAccount && (
            <span className="block text-xs text-slate-500">
              {row.bankAccount.bankName}
            </span>
          )}
          {row.reference && (
            <span className="block text-xs text-slate-400">
              {row.reference}
            </span>
          )}
        </span>
      ),
    },
    {
      header: 'Amount',
      numeric: true,
      cell: (row) => (
        <span className={row.voidedAt ? 'text-slate-400 line-through' : ''}>
          <Money value={row.amount} />
        </span>
      ),
    },
    {
      header: '',
      cell: (row) =>
        row.voidedAt ? (
          <span
            className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600"
            title={row.voidedReason ?? undefined}
          >
            voided
          </span>
        ) : (
          <Button variant="ghost" onClick={() => setVoiding(row)}>
            Void
          </Button>
        ),
    },
  ];

  const payments = data?.payments ?? [];

  return (
    <Page
      title="Paid out"
      description="Money that has gone to vendors, newest first."
    >
      <div className="mb-4 max-w-xs">
        <Field label="Vendor" htmlFor="paid-supplier">
          <Select
            id="paid-supplier"
            value={supplierId}
            onChange={(event) => setSupplierId(event.target.value)}
          >
            <option value="">Everyone</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {error && (
        <p
          className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700"
          role="alert"
        >
          {error}
        </p>
      )}

      <DataTable
        rows={payments}
        columns={columns}
        rowKey={(row) => row.id}
        loading={isPending}
        empty="Nothing has been paid to a vendor yet."
      />

      <p className="mt-4 text-xs text-slate-500">
        Voided payments stay on this list — it is the record of what was
        recorded, mistakes included. They stop counting against the bill, which
        goes back to owing on <strong>We owe</strong>.
      </p>

      {voiding && (
        <VoidSupplierPaymentDialog
          payment={voiding}
          busy={voidPayment.isPending}
          error={error}
          onCancel={() => {
            setVoiding(null);
            setError(null);
          }}
          onConfirm={(reason) =>
            voidPayment.mutate({ id: voiding.id, reason })
          }
        />
      )}
    </Page>
  );
}

/**
 * Voiding a payment to a vendor.
 *
 * **Deliberately not the customer-side dialog with the words swapped.** That
 * one offers "record money going back instead", because a refund to a customer
 * is an ordinary thing. There is no equivalent here: this side has no negative
 * payments at all, and the write path refuses one (§16). Offering the choice
 * would invent a feature the server does not have.
 *
 * So the alternative this names is the real one — if the vendor was genuinely
 * owed less than was recorded, the bill's amount is what is wrong, not the
 * payment.
 */
function VoidSupplierPaymentDialog({
  payment,
  onConfirm,
  onCancel,
  busy,
  error,
}: {
  payment: SupplierPaymentView;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
}) {
  const [reason, setReason] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = reason.trim();
    if (trimmed) onConfirm(trimmed);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="void-supplier-payment"
    >
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-lg"
      >
        <h2
          id="void-supplier-payment"
          className="text-lg font-semibold text-slate-900"
        >
          Void this payment?
        </h2>

        <p className="mt-2 rounded-md bg-slate-50 p-3 text-sm text-slate-700">
          <Money value={payment.amount} /> to {payment.supplier.name}
          {payment.bill.invoiceNumber
            ? `, against ${payment.bill.invoiceNumber}`
            : ''}
          .
        </p>

        <p className="mt-3 text-sm text-slate-500">
          A void says <strong>the money never moved</strong> — it was keyed by
          mistake, or against the wrong vendor. The payment stays on the list
          as a record, stops counting, and the bill goes back to owing.
        </p>

        <p className="mt-2 text-sm text-slate-500">
          If the money did move and the vendor owes you some of it back, this
          is the wrong tool: there is no negative payment on this side. Correct
          what the bill says is due instead.
        </p>

        <div className="mt-4">
          <Field label="Reason" htmlFor="void-supplier-reason">
            <Input
              id="void-supplier-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Keyed against the wrong vendor."
              autoFocus
              required
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
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
            disabled={busy}
          >
            Keep it
          </Button>
          <Button
            type="submit"
            variant="danger"
            disabled={busy || !reason.trim()}
          >
            {busy ? 'Voiding…' : 'Void payment'}
          </Button>
        </div>
      </form>
    </div>
  );
}
