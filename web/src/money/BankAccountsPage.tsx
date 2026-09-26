import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Button } from '../components/Button';
import { Field, Input } from '../components/Field';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import { useIsManager } from '../auth/useAuth';
import type { components } from '../api/schema';

type BankAccountView = components['schemas']['BankAccountView'];

/**
 * The accounts money is paid into.
 *
 * Several is normal for a business here and five is not unusual — one per bank
 * its customers already use, often a separate one for POS settlement — which
 * is why this is a table rather than a field on the organization
 * (DECISIONS.md §11).
 *
 * **An account with payments against it can never be deleted, only
 * deactivated.** Those payments still have to say where the money went, which
 * is the one question this model exists to answer. The server refuses the
 * delete with a 409 naming the count; this screen offers deactivation first so
 * nobody has to discover that.
 */
export function BankAccountsPage() {
  const queryClient = useQueryClient();
  const isManager = useIsManager();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: accounts = [], isPending } = useQuery({
    queryKey: ['bank-accounts', 'all'],
    queryFn: () =>
      api.get<BankAccountView[]>('/bank-accounts?includeInactive=true'),
  });

  const setActive = useMutation({
    mutationFn: (input: { id: string; isActive: boolean }) =>
      api.patch<BankAccountView>(`/bank-accounts/${input.id}`, {
        isActive: input.isActive,
      }),
    onSuccess: () => {
      afterWrite(queryClient);
      setError(null);
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError ? caught.message : 'Could not change that.',
      ),
  });

  return (
    <Page
      title="Accounts"
      description="Where money is paid in. Printed on every invoice, default first."
      actions={
        isManager ? (
          <Button onClick={() => setAdding(true)}>Add account</Button>
        ) : undefined
      }
    >
      {error && (
        <p
          className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700"
          role="alert"
        >
          {error}
        </p>
      )}

      {isPending && <p className="text-sm text-slate-500">Loading…</p>}

      {!isPending && accounts.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">
          No accounts yet. Transfers and POS payments cannot be recorded until
          there is one.
        </div>
      )}

      <div className="space-y-3">
        {accounts.map((account) => (
          <div
            key={account.id}
            className={`flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4 ${
              account.isActive ? '' : 'opacity-60'
            }`}
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-900">
                  {account.bankName}
                </span>
                {account.isDefault && (
                  <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs text-white">
                    default
                  </span>
                )}
                {!account.isActive && (
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600">
                    closed
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-sm text-slate-600">
                {account.accountName} · {account.accountNumber}
              </div>
              {account.note && (
                <div className="mt-1 text-xs text-slate-400">
                  {account.note}
                </div>
              )}
            </div>

            {isManager && (
              <Button
                variant="secondary"
                disabled={setActive.isPending}
                onClick={() =>
                  setActive.mutate({
                    id: account.id,
                    isActive: !account.isActive,
                  })
                }
              >
                {account.isActive ? 'Close' : 'Reopen'}
              </Button>
            )}
          </div>
        ))}
      </div>

      {adding && <AccountDialog onClose={() => setAdding(false)} />}
    </Page>
  );
}

function AccountDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [bankName, setBankName] = useState('');
  const [accountName, setAccountName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.post<BankAccountView>('/bank-accounts', {
        id: crypto.randomUUID(),
        bankName: bankName.trim(),
        accountName: accountName.trim(),
        accountNumber: accountNumber.trim(),
        isDefault,
      }),
    onSuccess: () => {
      afterWrite(queryClient);
      onClose();
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not save that account.',
      ),
  });

  const ready =
    bankName.trim() && accountName.trim() && accountNumber.trim().length >= 6;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (ready) create.mutate();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-title"
    >
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-lg"
      >
        <h2 id="account-title" className="text-lg font-semibold text-slate-900">
          Add an account
        </h2>

        <div className="mt-4 space-y-4">
          <Field label="Bank" htmlFor="bank-name">
            <Input
              id="bank-name"
              value={bankName}
              onChange={(event) => setBankName(event.target.value)}
              placeholder="GTBank"
              autoFocus
              required
            />
          </Field>

          <Field label="Account name" htmlFor="account-name">
            <Input
              id="account-name"
              value={accountName}
              onChange={(event) => setAccountName(event.target.value)}
              placeholder="Adebayo Stores Limited"
              required
            />
          </Field>

          <Field
            label="Account number"
            htmlFor="account-number"
            hint="Spaces and dashes are fine — they are stripped."
          >
            <Input
              id="account-number"
              value={accountNumber}
              onChange={(event) => setAccountNumber(event.target.value)}
              inputMode="numeric"
              placeholder="0123456789"
              required
            />
          </Field>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(event) => setIsDefault(event.target.checked)}
            />
            <span className="text-slate-700">
              Print this one first on invoices
            </span>
          </label>
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
            onClick={onClose}
            disabled={create.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending || !ready}>
            {create.isPending ? 'Saving…' : 'Add account'}
          </Button>
        </div>
      </form>
    </div>
  );
}
