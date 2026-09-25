import { useState, type FormEvent } from 'react';
import { Button } from '../components/Button';
import { Field, Input } from '../components/Field';
import { Money } from '../components/Money';
import type { components } from '../api/schema';

type PaymentView = components['schemas']['PaymentView'];

/**
 * Voiding a payment — and the screen that has to keep it apart from a refund.
 *
 * **Correcting a mistake is a void; correcting reality is a negative payment**
 * (DECISIONS.md §5). A void says the money never moved: a mis-keyed amount, a
 * collection booked against the wrong customer. A negative payment says money
 * moved *back*: a refund, a bounced cheque.
 *
 * This is the one distinction in the money model that a UI can quietly destroy.
 * Both make an invoice owed again, so they look interchangeable from the
 * outside — but a void leaves no trace in what was collected, while a refund is
 * real money out that a bank statement will show. Choose wrong and the books
 * disagree with the bank, with nothing on screen to say why.
 *
 * So the dialog says what a void *means* in words before asking for a reason,
 * and names the alternative rather than leaving someone to guess. The row and
 * its allocations are kept either way, so the mistake and its correction both
 * stay legible.
 */
export function VoidPaymentDialog({
  payment,
  onConfirm,
  onCancel,
  onRefundInstead,
  busy,
  error,
}: {
  payment: PaymentView;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  onRefundInstead: () => void;
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
      aria-labelledby="void-title"
    >
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-lg"
      >
        <h2 id="void-title" className="text-lg font-semibold text-slate-900">
          Void this payment?
        </h2>

        <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">
              {payment.method}
              {payment.reference ? ` · ${payment.reference}` : ''}
            </span>
            <span className="font-medium text-slate-900">
              <Money value={payment.amount} signed />
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {new Date(payment.occurredAt).toLocaleString('en-NG')}
            {payment.customer
              ? ` · ${[payment.customer.firstName, payment.customer.lastName].filter(Boolean).join(' ')}`
              : ''}
          </div>
        </div>

        <p className="mt-4 text-sm text-slate-700">
          Voiding says <strong>this money never moved</strong> — a mis-key, or a
          collection put against the wrong customer. The row is kept with your
          reason, stops counting, and the invoices it settled go back to owing.
        </p>

        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p>
            If the money <strong>did</strong> move and is going back to the
            customer — a refund, a bounced cheque — that is a negative payment,
            not a void.
          </p>
          <button
            type="button"
            onClick={onRefundInstead}
            disabled={busy}
            className="mt-2 text-xs font-medium underline underline-offset-2"
          >
            Record money going back instead
          </button>
        </div>

        <div className="mt-4">
          <Field label="Reason" htmlFor="void-reason">
            <Input
              id="void-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Keyed twice by mistake."
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
          <Button type="submit" variant="danger" disabled={busy || !reason.trim()}>
            {busy ? 'Voiding…' : 'Void payment'}
          </Button>
        </div>
      </form>
    </div>
  );
}
