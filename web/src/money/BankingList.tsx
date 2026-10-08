import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import type { components } from '../api/schema';
import { useAuth } from '../auth/useAuth';
import { Button } from '../components/Button';
import { DataTable, type Column } from '../components/DataTable';
import { DialogClose } from '../components/DialogClose';
import { Field, Input, Select } from '../components/Field';
import { Money } from '../components/Money';
import { BANKING_STATUS_LABEL, personName } from './cashNames';

type CashBankingView = components['schemas']['CashBankingView'];
type CashBankingListView = components['schemas']['CashBankingListView'];

const STATUS_TONE: Record<string, string> = {
  waiting: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-emerald-100 text-emerald-800',
  not_received: 'bg-slate-200 text-slate-600',
};

/**
 * Cash recorded as banked, newest first — shared by Money → Cash and Sales →
 * My cash. The server already narrows staff to their own rows.
 *
 * Confirm and Not received show only for the owner and managers, and Confirm
 * not on a manager's own banking: **nobody confirms their own**. That is the
 * server's rule; hiding the button only saves somebody a refusal.
 */
export function BankingList({
  showWho,
  onlyUserId,
}: {
  showWho: boolean;
  /** One person's banking — My cash, for an owner who would otherwise see everyone's. */
  onlyUserId?: string;
}) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [status, setStatus] = useState('');
  const [refusing, setRefusing] = useState<CashBankingView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const role = user?.orgRole;
  const confirms = role === 'owner' || role === 'manager';
  const mayConfirm = (row: CashBankingView) =>
    role === 'owner' || (role === 'manager' && row.heldBy.id !== user?.sub);

  const query = new URLSearchParams({ order: 'desc', limit: '100' });
  if (status) query.set('status', status);
  if (onlyUserId) query.set('heldByUserId', onlyUserId);

  const { data, isPending } = useQuery({
    queryKey: ['cash-bankings', query.toString()],
    queryFn: () => api.get<CashBankingListView>(`/cash/bankings?${query}`),
  });

  const onError = (caught: unknown) =>
    setError(
      caught instanceof ApiError ? caught.message : 'That did not go through.',
    );

  const confirm = useMutation({
    mutationFn: (id: string) =>
      api.post<CashBankingView>(`/cash/bankings/${id}/confirm`, {}),
    onSuccess: () => {
      afterWrite(queryClient);
      setError(null);
    },
    onError,
  });

  const refuse = useMutation({
    mutationFn: (input: { id: string; reason: string }) =>
      api.post<CashBankingView>(`/cash/bankings/${input.id}/void`, {
        reason: input.reason,
      }),
    onSuccess: () => {
      afterWrite(queryClient);
      setRefusing(null);
      setError(null);
    },
    onError,
  });

  const columns: Column<CashBankingView>[] = [
    {
      header: 'Banked on',
      cell: (row) => (
        <span className="whitespace-nowrap text-slate-600">
          {new Date(row.occurredAt).toLocaleDateString()}
        </span>
      ),
    },
    ...(showWho
      ? [
          {
            header: 'Whose cash',
            cell: (row: CashBankingView) => (
              <span className="font-medium text-slate-900">
                {personName(row.heldBy)}
              </span>
            ),
          },
        ]
      : []),
    {
      header: 'Where it went',
      cell: (row) =>
        row.bankAccount ? (
          <span>
            {row.bankAccount.bankName}
            <span className="block text-xs text-slate-500">
              {row.bankAccount.accountNumber}
              {row.reference ? ` · ${row.reference}` : ''}
            </span>
          </span>
        ) : (
          'Handed to the owner'
        ),
    },
    {
      header: 'Amount',
      numeric: true,
      cell: (row) => (
        <span
          className={
            row.status === 'not_received' ? 'text-slate-400 line-through' : ''
          }
        >
          <Money value={row.amount} />
        </span>
      ),
    },
    {
      header: 'Status',
      cell: (row) => (
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${STATUS_TONE[row.status]}`}
          title={
            row.status === 'not_received'
              ? (row.voidedReason ?? undefined)
              : row.confirmedBy
                ? `By ${personName(row.confirmedBy)}`
                : undefined
          }
        >
          {BANKING_STATUS_LABEL[row.status]}
        </span>
      ),
    },
    ...(confirms
      ? [
          {
            header: '',
            cell: (row: CashBankingView) =>
              row.status === 'not_received' ? null : (
                <span className="flex justify-end gap-1">
                  {row.status === 'waiting' && mayConfirm(row) && (
                    <Button
                      variant="secondary"
                      onClick={() => confirm.mutate(row.id)}
                      disabled={confirm.isPending}
                    >
                      Confirm
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => setRefusing(row)}>
                    Not received
                  </Button>
                </span>
              ),
          },
        ]
      : []),
  ];

  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900">Banking</h2>
        <div className="w-48">
          <Field label="Show" htmlFor="banking-status">
            <Select
              id="banking-status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">All</option>
              <option value="waiting">Waiting to confirm</option>
              <option value="confirmed">Confirmed</option>
              <option value="not_received">Not received</option>
            </Select>
          </Field>
        </div>
      </div>

      {error && !refusing && (
        <p
          className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700"
          role="alert"
        >
          {error}
        </p>
      )}

      <DataTable
        rows={data?.bankings ?? []}
        columns={columns}
        rowKey={(row) => row.id}
        loading={isPending}
        empty="No cash recorded as banked yet."
      />

      {refusing && (
        <NotReceivedDialog
          banking={refusing}
          busy={refuse.isPending}
          error={error}
          onCancel={() => {
            setRefusing(null);
            setError(null);
          }}
          onConfirm={(reason) => refuse.mutate({ id: refusing.id, reason })}
        />
      )}
    </section>
  );
}

/**
 * The money did not arrive where the row says. It goes back to the person's
 * still holding, and the row stays with the reason.
 */
function NotReceivedDialog({
  banking,
  onConfirm,
  onCancel,
  busy,
  error,
}: {
  banking: CashBankingView;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
}) {
  const [reason, setReason] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (reason.trim()) onConfirm(reason.trim());
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="not-received-title"
    >
      <form
        onSubmit={submit}
        className="relative w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-lg"
      >
        <DialogClose onClose={onCancel} />
        <h2
          id="not-received-title"
          className="text-lg font-semibold text-slate-900"
        >
          Not received?
        </h2>
        <p className="mt-3 text-sm text-slate-700">
          <Money value={banking.amount} /> from {personName(banking.heldBy)}{' '}
          goes back to what they are <strong>still holding</strong>. The record
          stays, with your reason.
        </p>
        <div className="mt-4">
          <Field label="Reason" htmlFor="not-received-reason">
            <Input
              id="not-received-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Not on the statement for that day."
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
            {busy ? 'Saving…' : 'Mark not received'}
          </Button>
        </div>
      </form>
    </div>
  );
}
