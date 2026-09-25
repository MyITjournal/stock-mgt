import { useMemo, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../components/Button';
import { Field, Input, MoneyInput, Select } from '../components/Field';
import { Money } from '../components/Money';
import { api } from '../api/client';
import { needsBankAccount, type PaymentMethod } from '../till/payment';
import type { components } from '../api/schema';

type CustomerView = components['schemas']['CustomerView'];
type BankAccountView = components['schemas']['BankAccountView'];
type ReceivablesView = components['schemas']['ReceivablesView'];

export interface PaymentDraft {
  customerId: string | null;
  amount: number;
  method: PaymentMethod;
  bankAccountId: string | null;
  reference: string;
  note: string;
  /** Empty means "let the server settle the oldest first". */
  allocations: { saleId: string; amount: number }[];
}

/**
 * Taking money that is not part of a sale — a customer settling what they owe.
 *
 * **A payment is one row per thing that happened.** A ₦50,000 transfer
 * settling three invoices is one payment with three allocations, not three
 * payments, because ₦50,000 is the number on the bank statement somebody will
 * reconcile against later (DECISIONS.md §5).
 *
 * **Allocations are validated, never spread cleverly.** The form offers two
 * honest choices: let the server settle the oldest invoices first, or say
 * exactly which invoice gets what. There is no third mode where the UI guesses
 * and the person cannot tell what it decided. Over-allocating a single invoice
 * comes back as a 409; money left over deliberately stays as credit on the
 * customer rather than being pushed somewhere it was not meant to go.
 */
export function RecordPaymentDialog({
  customerId: fixedCustomerId,
  onConfirm,
  onCancel,
  busy,
  error,
}: {
  customerId?: string;
  onConfirm: (draft: PaymentDraft) => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
}) {
  const [customerId, setCustomerId] = useState(fixedCustomerId ?? '');
  const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [bankAccountId, setBankAccountId] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [manual, setManual] = useState(false);
  const [split, setSplit] = useState<Record<string, number | null>>({});

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => api.get<CustomerView[]>('/customers'),
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: () => api.get<BankAccountView[]>('/bank-accounts'),
  });

  const { data: owed } = useQuery({
    queryKey: ['receivables', customerId],
    queryFn: () =>
      api.get<ReceivablesView>(
        `/receivables${customerId ? `?customerId=${customerId}` : ''}`,
      ),
    enabled: Boolean(customerId),
  });

  const invoices = useMemo(
    () => owed?.invoices.filter((invoice) => invoice.balance > 0) ?? [],
    [owed],
  );

  // The explicit <number> matters: the values are `number | null`, so without
  // it the accumulator widens to `number | null` and every comparison below
  // becomes a possibly-null one.
  const allocated = Object.values(split).reduce<number>(
    (total, value) => total + (value ?? 0),
    0,
  );
  const paying = amount ?? 0;

  const requiresAccount = needsBankAccount(method);
  const canSubmit =
    paying !== 0 &&
    Boolean(customerId) &&
    (!requiresAccount || Boolean(bankAccountId)) &&
    (!manual || allocated <= paying);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    onConfirm({
      customerId: customerId || null,
      amount: paying,
      method,
      bankAccountId: requiresAccount ? bankAccountId || null : null,
      reference: reference.trim(),
      note: note.trim(),
      allocations: manual
        ? Object.entries(split)
            .filter(([, value]) => value && value > 0)
            .map(([saleId, value]) => ({ saleId, amount: value as number }))
        : [],
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="payment-title"
    >
      <form
        onSubmit={submit}
        className="my-8 w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-lg"
      >
        <h2 id="payment-title" className="text-lg font-semibold text-slate-900">
          Record a payment
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          One row per thing that happened, so it still matches the bank
          statement.
        </p>

        <div className="mt-5 space-y-4">
          <Field label="From" htmlFor="payer">
            <Select
              id="payer"
              value={customerId}
              disabled={busy || Boolean(fixedCustomerId)}
              onChange={(event) => {
                setCustomerId(event.target.value);
                setSplit({});
              }}
              required
            >
              <option value="">Choose a customer…</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {[customer.firstName, customer.lastName]
                    .filter(Boolean)
                    .join(' ')}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Amount"
            htmlFor="amount"
            hint="A negative amount is money handed back."
          >
            <MoneyInput
              id="amount"
              value={amount}
              disabled={busy}
              onChange={setAmount}
            />
          </Field>

          <Field label="Method" htmlFor="method">
            <Select
              id="method"
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
              label="Paid into"
              htmlFor="account"
              hint="Never guessed — a wrong account only shows up at reconciliation."
            >
              <Select
                id="account"
                value={bankAccountId}
                disabled={busy}
                onChange={(event) => setBankAccountId(event.target.value)}
                required
              >
                <option value="">Choose an account…</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.bankName} · {account.accountNumber}
                    {account.isDefault ? ' (default)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {method !== 'cash' && (
            <Field label="Reference" htmlFor="reference">
              <Input
                id="reference"
                value={reference}
                disabled={busy}
                onChange={(event) => setReference(event.target.value)}
                placeholder="FT26083012345"
              />
            </Field>
          )}

          {customerId && invoices.length > 0 && (
            <div className="rounded-lg border border-slate-200 p-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={manual}
                  disabled={busy}
                  onChange={(event) => {
                    setManual(event.target.checked);
                    setSplit({});
                  }}
                />
                <span className="text-slate-700">
                  Choose which invoices this settles
                </span>
              </label>

              {!manual && (
                <p className="mt-2 text-xs text-slate-500">
                  Settling the oldest invoices first. Anything left over stays
                  as credit on the customer.
                </p>
              )}

              {manual && (
                <div className="mt-3 space-y-2">
                  {invoices.map((invoice) => (
                    <div
                      key={invoice.id}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="flex-1">
                        <span className="text-slate-900">{invoice.number}</span>
                        <span className="ml-2 text-xs text-slate-500">
                          owes <Money value={invoice.balance} /> ·{' '}
                          {invoice.daysOutstanding}d
                        </span>
                      </span>
                      <MoneyInput
                        id={`alloc-${invoice.id}`}
                        aria-label={`Amount against ${invoice.number}`}
                        value={split[invoice.id] ?? null}
                        disabled={busy}
                        onChange={(value) =>
                          setSplit((current) => ({
                            ...current,
                            [invoice.id]: value,
                          }))
                        }
                        className="w-28 text-right"
                      />
                    </div>
                  ))}

                  <div className="flex justify-between border-t border-slate-100 pt-2 text-xs">
                    <span className="text-slate-500">Allocated</span>
                    <span
                      className={
                        allocated > paying
                          ? 'font-medium text-red-600'
                          : 'text-slate-700'
                      }
                    >
                      <Money value={allocated} /> of <Money value={paying} />
                    </span>
                  </div>

                  {allocated > paying && (
                    <p className="text-xs text-red-600">
                      That is more than the payment.
                    </p>
                  )}
                  {allocated < paying && allocated > 0 && (
                    <p className="text-xs text-slate-500">
                      <Money value={paying - allocated} /> stays as credit.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <Field label="Note" htmlFor="note">
            <Input
              id="note"
              value={note}
              disabled={busy}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Part payment, balance on Friday."
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
