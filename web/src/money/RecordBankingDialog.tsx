import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import type { components } from '../api/schema';
import { DialogClose } from '../components/DialogClose';
import { Button } from '../components/Button';
import { Field, Input, MoneyInput, Select } from '../components/Field';
import { Money } from '../components/Money';
import { occurredAtFor, today } from '../lib/paidOn';
import { personName } from './cashNames';

type CashPersonView = components['schemas']['CashPersonView'];
type CashBankingView = components['schemas']['CashBankingView'];
type BankAccountView = components['schemas']['BankAccountView'];

/**
 * "Record cash banked" — on Money → Cash for anyone, on Sales → My cash for
 * yourself (2026-10-08).
 *
 * `people` is who may be picked. Staff are handed only themselves, so there is
 * no picker; the server refuses anybody else whatever this renders.
 *
 * **The account is never pre-picked**, the same rule as a transfer on Money in:
 * a wrong account surfaces only when the statement does not match.
 */
export function RecordBankingDialog({
  people,
  initialPerson,
  onClose,
}: {
  people: readonly CashPersonView[];
  initialPerson: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  // Minted once, so a retry of this same banking is recognised as the same row.
  const [id] = useState(() => crypto.randomUUID());
  const [heldBy, setHeldBy] = useState(initialPerson);
  const [amount, setAmount] = useState<number | null>(null);
  const [to, setTo] = useState<'bank' | 'owner'>('bank');
  const [bankAccountId, setBankAccountId] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [day, setDay] = useState(today());
  const [error, setError] = useState<string | null>(null);

  const { data: accounts = [] } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: () => api.get<BankAccountView[]>('/bank-accounts'),
  });

  const person = people.find((row) => row.userId === heldBy);

  const record = useMutation({
    mutationFn: () =>
      api.post<CashBankingView>('/cash/bankings', {
        id,
        heldByUserId: heldBy,
        amount,
        to,
        ...(to === 'bank' && { bankAccountId }),
        ...(reference.trim() && { reference: reference.trim() }),
        ...(note.trim() && { note: note.trim() }),
        ...occurredAtFor(day),
      }),
    onSuccess: () => {
      afterWrite(queryClient);
      onClose();
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError ? caught.message : 'Could not record that.',
      ),
  });

  const ready =
    amount !== null && amount > 0 && (to === 'owner' || bankAccountId !== '');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (ready) record.mutate();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="banking-title"
    >
      <form
        onSubmit={submit}
        className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-lg"
      >
        <DialogClose onClose={onClose} />
        <h2 id="banking-title" className="text-lg font-semibold text-slate-900">
          Record cash banked
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Cash leaving somebody’s hands. It is not a payment or an expense — the
          money was counted when the customer paid.
        </p>

        <div className="mt-4 space-y-4">
          {people.length > 1 && (
            <Field label="Whose cash" htmlFor="banking-person">
              <Select
                id="banking-person"
                value={heldBy}
                onChange={(event) => setHeldBy(event.target.value)}
              >
                {people.map((row) => (
                  <option key={row.userId} value={row.userId}>
                    {personName(row)}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <div>
            <Field label="Amount" htmlFor="banking-amount">
              <MoneyInput
                id="banking-amount"
                value={amount}
                onChange={setAmount}
                autoFocus
                required
              />
            </Field>
            {person && (
              <p className="mt-1 text-xs text-slate-500">
                Still holding <Money value={person.stillHolding} />. Bank what
                you have — anything short stays as still holding.
              </p>
            )}
          </div>

          <fieldset>
            <legend className="mb-1 text-sm font-medium text-slate-700">
              Where it went
            </legend>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="banking-to"
                  checked={to === 'bank'}
                  onChange={() => setTo('bank')}
                />
                Into a bank account
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="banking-to"
                  checked={to === 'owner'}
                  onChange={() => setTo('owner')}
                />
                Handed to the owner
              </label>
            </div>
          </fieldset>

          {to === 'bank' && (
            <Field label="Account" htmlFor="banking-account">
              <Select
                id="banking-account"
                value={bankAccountId}
                onChange={(event) => setBankAccountId(event.target.value)}
                required
              >
                <option value="">Choose the account…</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.bankName} — {account.accountNumber}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {to === 'bank' && (
            <Field
              label="Slip or reference"
              htmlFor="banking-reference"
              hint="Optional — the teller number on the deposit slip."
            >
              <Input
                id="banking-reference"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
              />
            </Field>
          )}

          <Field label="Banked on" htmlFor="banking-day">
            <Input
              id="banking-day"
              type="date"
              value={day}
              max={today()}
              onChange={(event) => setDay(event.target.value)}
            />
          </Field>

          <Field label="Note" htmlFor="banking-note" hint="Optional.">
            <Input
              id="banking-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
        </div>

        {error && (
          <p
            className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700"
            role="alert"
          >
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!ready || record.isPending}>
            {record.isPending ? 'Recording…' : 'Record it'}
          </Button>
        </div>
      </form>
    </div>
  );
}
