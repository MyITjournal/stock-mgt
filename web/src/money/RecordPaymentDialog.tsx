import { useMemo, useState, type FormEvent } from 'react';
import { DialogClose } from '../components/DialogClose';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../components/Button';
import { Field, Input, MoneyInput, Select } from '../components/Field';
import { Money } from '../components/Money';
import { api } from '../api/client';
import { PaidOnField } from '../components/PaidOnField';
import { occurredAtFor, today } from '../lib/paidOn';
import { needsBankAccount, type PaymentMethod } from '../till/payment';
import type { components } from '../api/schema';

type CustomerView = components['schemas']['CustomerView'];
type BankAccountView = components['schemas']['BankAccountView'];
type ReceivablesView = components['schemas']['ReceivablesView'];
type LocationView = components['schemas']['LocationView'];

/** The one invoice a "Mark as paid" is for. */
export interface InvoiceToSettle {
  saleId: string;
  number: string;
  customerId: string;
  /** What the server says it still owes. */
  balance: number;
}

export interface PaymentDraft {
  customerId: string | null;
  amount: number;
  method: PaymentMethod;
  bankAccountId: string | null;
  reference: string;
  note: string;
  /** Empty means "let the server settle the oldest first". */
  allocations: { saleId: string; amount: number }[];
  /** When the money moved, for a payment recorded after the day. */
  occurredAt?: string;
  /**
   * The store that took it (2026-10-08). The default store when the shop has
   * one and nobody picked; null only while the stores are still loading.
   */
  locationId: string | null;
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
 *
 * **`invoice` is "Mark as paid"**: the payment is for that invoice and no
 * other, the amount starts at what it still owes, and the allocation is
 * exactly that invoice — paying more leaves the rest as credit, the same as
 * anywhere else. Method and account are still asked, never guessed (§11).
 */
export function RecordPaymentDialog({
  customerId: fixedCustomerId,
  invoice,
  onConfirm,
  onCancel,
  busy,
  error,
}: {
  customerId?: string;
  /** Settle this one invoice — "Mark as paid". */
  invoice?: InvoiceToSettle;
  onConfirm: (draft: PaymentDraft) => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
}) {
  const [customerId, setCustomerId] = useState(
    invoice?.customerId ?? fixedCustomerId ?? '',
  );
  const [paidOn, setPaidOn] = useState(today);
  const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [bankAccountId, setBankAccountId] = useState('');
  // Empty means the default store — the same one a sale at the till lands in.
  const [pickedLocation, setPickedLocation] = useState('');
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

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: () => api.get<LocationView[]>('/locations'),
  });
  const defaultLocation =
    locations.find((location) => location.isDefault) ?? locations[0];
  const locationId = pickedLocation || defaultLocation?.id || '';

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
  // Until somebody types, "Mark as paid" means everything the invoice owes.
  const shownAmount = amount ?? invoice?.balance ?? null;
  const paying = shownAmount ?? 0;

  // The two mix-ups between "Amount received" and the boxes beside each
  // invoice (owner, 2026-10-09). An invoice's own total typed into its box
  // shows up as more than the invoice owes or more than was received; the
  // invoice's total typed as the amount received leaves the difference as
  // credit while that invoice still owes — `strandedCredit`, said out loud
  // before saving rather than in a grey line.
  const overInvoice = manual
    ? invoices.filter((row) => (split[row.id] ?? 0) > row.balance)
    : [];
  const stillOwing = invoices.some((row) => (split[row.id] ?? 0) < row.balance);
  const strandedCredit =
    manual && allocated > 0 && allocated < paying && stillOwing
      ? paying - allocated
      : 0;
  const payer = customers.find((customer) => customer.id === customerId);
  const payerName = payer
    ? [payer.firstName, payer.lastName].filter(Boolean).join(' ')
    : 'the customer';

  const requiresAccount = needsBankAccount(method);
  const canSubmit =
    paying !== 0 &&
    Boolean(customerId) &&
    (!requiresAccount || Boolean(bankAccountId)) &&
    (!manual || (allocated <= paying && overInvoice.length === 0)) &&
    // Marking an invoice paid is money in; handing money back is not that.
    (!invoice || paying > 0);

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
      allocations: invoice
        ? // Exactly this invoice, never more than it owes; the rest is credit.
          [
            {
              saleId: invoice.saleId,
              amount: Math.min(paying, invoice.balance),
            },
          ]
        : manual
          ? Object.entries(split)
              .filter(([, value]) => value && value > 0)
              .map(([saleId, value]) => ({ saleId, amount: value as number }))
          : [],
      ...occurredAtFor(paidOn),
      locationId: locationId || null,
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
        className="relative my-8 w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-lg"
      >
        <DialogClose onClose={onCancel} />

        <h2 id="payment-title" className="text-lg font-semibold text-slate-900">
          {invoice ? `Mark ${invoice.number} as paid` : 'Record a payment'}
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
              disabled={busy || Boolean(fixedCustomerId) || Boolean(invoice)}
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
            label="Amount received"
            htmlFor="amount"
            hint="What the customer actually handed over. A negative amount is money handed back."
          >
            <MoneyInput
              id="amount"
              value={shownAmount}
              disabled={busy}
              onChange={setAmount}
            />
          </Field>

          <PaidOnField
            id="payment-date"
            value={paidOn}
            onChange={setPaidOn}
            disabled={busy}
          />

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

          {/*
            The store is recorded silently when there is only one, and asked
            for — starting at the default — when there are several. Before
            2026-10-08 nothing was sent, and every payment here landed under
            "Not at a counter" on the collections report.
          */}
          {locations.length > 1 && (
            <Field label="Store" htmlFor="payment-store">
              <Select
                id="payment-store"
                value={locationId}
                disabled={busy}
                onChange={(event) => setPickedLocation(event.target.value)}
              >
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}

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

          {invoice && (
            <p className="rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
              Pays <strong>{invoice.number}</strong>, which owes{' '}
              <Money value={invoice.balance} />. Anything above that stays as
              credit on the customer.
            </p>
          )}

          {!invoice && customerId && invoices.length > 0 && (
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
                  <p className="text-sm font-medium text-slate-900">
                    How much of this payment goes to each invoice
                  </p>
                  <p className="text-xs text-slate-500">
                    A part of the amount received — not the invoice's total.
                  </p>
                  {invoices.map((invoice) => (
                    <div
                      key={invoice.id}
                      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm"
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
                      {(split[invoice.id] ?? 0) > invoice.balance && (
                        <p className="w-full text-xs text-red-600">
                          {invoice.number} owes only{' '}
                          <Money value={invoice.balance} />. Put at most that
                          here — anything more stays as credit.
                        </p>
                      )}
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
                    <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">
                      You've put <Money value={allocated} /> against invoices,
                      but only <Money value={paying} /> was received. These
                      boxes are how much of the payment goes to each invoice,
                      not the invoice totals.
                    </p>
                  )}
                  {allocated < paying && allocated > 0 && !strandedCredit && (
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

        {strandedCredit > 0 && (
          <p
            className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-800"
            role="status"
          >
            <Money value={strandedCredit} /> of this will be kept as credit on{' '}
            {payerName}, not put against an invoice. Is <Money value={paying} />{' '}
            what you received?
          </p>
        )}

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
