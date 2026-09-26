import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../components/Button';
import { Field, Input, MoneyInput, Select } from '../components/Field';
import { Money } from '../components/Money';
import { api } from '../api/client';
import { needsBankAccount, type PaymentMethod } from '../till/payment';
import type { components } from '../api/schema';

type SupplierBillView = components['schemas']['SupplierBillView'];
type BankAccountView = components['schemas']['BankAccountView'];

export interface SupplierPaymentDraft {
  billId: string;
  amount: number;
  method: PaymentMethod;
  bankAccountId: string | null;
  reference: string;
  note: string;
}

/**
 * Paying a vendor.
 *
 * **Deliberately not the customer payment dialog with the words swapped.** Two
 * differences are structural, not cosmetic (DECISIONS.md §16):
 *
 * - **One payment settles exactly one bill**, so this starts from a bill and
 *   has no allocation control. A lump sum across several deliveries would need
 *   an allocation table, and that is a migration on the day somebody does one.
 * - **There is no "money back" here.** A mis-key is voided; money genuinely
 *   coming back from a vendor is not a case this business has, and the write
 *   path refuses a negative amount. So this form cannot offer one, where the
 *   customer-side form deliberately can.
 *
 * Paying more than is outstanding is a 409 rather than a credit: the fix is to
 * correct the bill's `amountDue` if the invoice was higher than entered.
 */
export function PaySupplierDialog({
  billId,
  onConfirm,
  onCancel,
  busy,
  error,
}: {
  billId: string;
  onConfirm: (draft: SupplierPaymentDraft) => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
}) {
  const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('transfer');
  const [bankAccountId, setBankAccountId] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');

  const { data: bill } = useQuery({
    queryKey: ['supplier-bill', billId],
    queryFn: () => api.get<SupplierBillView>(`/supplier-bills/${billId}`),
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: () => api.get<BankAccountView[]>('/bank-accounts'),
  });

  const outstanding = bill?.balance ?? 0;
  const paying = amount ?? 0;
  const requiresAccount = needsBankAccount(method);
  const tooMuch = paying > outstanding;
  const canSubmit =
    paying > 0 && !tooMuch && (!requiresAccount || Boolean(bankAccountId));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    onConfirm({
      billId,
      amount: paying,
      method,
      bankAccountId: requiresAccount ? bankAccountId || null : null,
      reference: reference.trim(),
      note: note.trim(),
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pay-supplier-title"
    >
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-lg"
      >
        <h2
          id="pay-supplier-title"
          className="text-lg font-semibold text-slate-900"
        >
          Pay {bill?.supplier.name ?? 'vendor'}
        </h2>

        {bill && (
          <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">
                {bill.invoiceNumber ?? 'No invoice number'}
              </span>
              <span className="text-slate-500">
                billed <Money value={bill.amountDue} />
              </span>
            </div>
            <div className="mt-1 flex justify-between font-medium text-slate-900">
              <span>Still owing</span>
              <Money value={bill.balance} />
            </div>
          </div>
        )}

        <div className="mt-4 space-y-4">
          <Field
            label="Amount"
            htmlFor="pay-amount"
            hint="Part payments are fine. Paying more than is owed is refused."
            error={tooMuch ? 'That is more than this bill owes.' : undefined}
          >
            <MoneyInput
              id="pay-amount"
              value={amount}
              disabled={busy}
              onChange={setAmount}
            />
          </Field>

          <Field label="Method" htmlFor="pay-method">
            <Select
              id="pay-method"
              value={method}
              disabled={busy}
              onChange={(event) => {
                const next = event.target.value as PaymentMethod;
                setMethod(next);
                if (!needsBankAccount(next)) setBankAccountId('');
              }}
            >
              <option value="cash">Cash</option>
              <option value="transfer">Transfer</option>
              <option value="pos">POS</option>
              <option value="cheque">Cheque</option>
            </Select>
          </Field>

          {requiresAccount && (
            <Field
              label="Paid from"
              htmlFor="pay-account"
              hint="Which account the money left. Never guessed."
            >
              <Select
                id="pay-account"
                value={bankAccountId}
                disabled={busy}
                onChange={(event) => setBankAccountId(event.target.value)}
                required
              >
                <option value="">Choose an account…</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.bankName} · {account.accountNumber}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {method !== 'cash' && (
            <Field label="Reference" htmlFor="pay-reference">
              <Input
                id="pay-reference"
                value={reference}
                disabled={busy}
                onChange={(event) => setReference(event.target.value)}
              />
            </Field>
          )}

          <Field label="Note" htmlFor="pay-note">
            <Input
              id="pay-note"
              value={note}
              disabled={busy}
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
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !canSubmit}>
            {busy ? 'Recording…' : 'Record payment'}
          </Button>
        </div>
      </form>
    </div>
  );
}
