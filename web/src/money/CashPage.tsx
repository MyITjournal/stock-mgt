import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { components } from '../api/schema';
import { useAuth } from '../auth/useAuth';
import { Page } from '../components/Layout';
import { Button } from '../components/Button';
import { Money } from '../components/Money';
import { DataTable, type Column } from '../components/DataTable';
import { DownloadButton } from '../components/DownloadButton';
import { BankingList } from './BankingList';
import { RecordBankingDialog } from './RecordBankingDialog';
import { emptyRow, personName } from './cashNames';
import { exportCash } from './exportMoney';

type CashView = components['schemas']['CashView'];
type CashPersonView = components['schemas']['CashPersonView'];

/**
 * Money → Cash: whose hands the shop's cash is in (2026-10-08).
 *
 * One row per person — received in cash, paid out in cash, banked, waiting to
 * be confirmed, still holding — every figure the server's. A shortfall is
 * never written off; it stays as still holding until it is banked.
 *
 * The owner and managers record banking for anyone and confirm it; the
 * accountant sees everybody and records only their own.
 */
export function CashPage() {
  const { user } = useAuth();
  const [recording, setRecording] = useState(false);
  const recordsForAnyone =
    user?.orgRole === 'owner' || user?.orgRole === 'manager';

  const { data, isPending } = useQuery({
    queryKey: ['cash'],
    queryFn: () => api.get<CashView>('/cash'),
  });

  const people = data?.people ?? [];
  const me = people.find((person) => person.userId === user?.sub);
  const pickable = recordsForAnyone
    ? people
    : [me ?? emptyRow(user?.sub ?? '')];
  const firstHolding =
    pickable.find((person) => person.stillHolding > 0) ?? pickable[0];

  const columns: readonly Column<CashPersonView>[] = [
    {
      header: 'Person',
      cell: (row) => (
        <span className="font-medium text-slate-900">{personName(row)}</span>
      ),
      sortValue: (row) => personName(row),
    },
    {
      header: 'Received in cash',
      numeric: true,
      cell: (row) => <Money value={row.received} />,
      sortValue: (row) => row.received,
    },
    {
      header: 'Paid out in cash',
      numeric: true,
      cell: (row) => <Money value={row.paidOut} />,
      sortValue: (row) => row.paidOut,
    },
    {
      header: 'Banked',
      numeric: true,
      cell: (row) => <Money value={row.banked} />,
      sortValue: (row) => row.banked,
    },
    {
      header: 'Waiting to confirm',
      numeric: true,
      cell: (row) => <Money value={row.waiting} />,
      sortValue: (row) => row.waiting,
    },
    {
      header: 'Still holding',
      numeric: true,
      cell: (row) => (
        <span
          className={
            row.overdue ? 'font-semibold text-amber-700' : 'font-medium'
          }
        >
          <Money value={row.stillHolding} signed />
        </span>
      ),
      sortValue: (row) => row.stillHolding,
    },
    {
      header: 'Oldest unbanked',
      cell: (row) => (
        <OldestUnbanked at={row.oldestUnbankedAt} overdue={row.overdue} />
      ),
      sortValue: (row) => row.oldestUnbankedAt ?? '',
    },
  ];

  return (
    <Page
      title="Cash"
      description={
        data?.countedFrom
          ? `Cash taken and where it is now, counted from ${new Date(
              data.countedFrom,
            ).toLocaleDateString()}. Banking is not a payment or an expense.`
          : 'Cash taken and where it is now. Banking is not a payment or an expense.'
      }
      actions={
        <div className="flex gap-2">
          <DownloadButton onDownload={exportCash} />
          <Button onClick={() => setRecording(true)} disabled={isPending}>
            Record cash banked
          </Button>
        </div>
      }
    >
      {data && (
        <section className="mb-6 grid gap-4 sm:grid-cols-3">
          <CashStat
            label="Not yet banked"
            value={<Money value={data.totals.notBanked} />}
            note={
              data.totals.overdue
                ? 'Some of it is more than a day old.'
                : 'What people are still holding.'
            }
            warn={data.totals.overdue}
          />
          <CashStat
            label="Waiting to confirm"
            value={<Money value={data.totals.waiting} />}
            note="Recorded as banked, not yet checked."
          />
          <CashStat
            label="Banked"
            value={<Money value={data.totals.banked} />}
            note="Confirmed."
          />
        </section>
      )}

      <DataTable
        rows={people}
        columns={columns}
        rowKey={(row) => row.userId}
        loading={isPending}
        empty="Nobody has taken cash yet."
      />

      <BankingList showWho />

      {recording && firstHolding && (
        <RecordBankingDialog
          people={pickable}
          initialPerson={firstHolding.userId}
          onClose={() => setRecording(false)}
        />
      )}
    </Page>
  );
}

export function CashStat({
  label,
  value,
  note,
  warn = false,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  warn?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        warn ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'
      }`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
    </div>
  );
}

export function OldestUnbanked({
  at,
  overdue,
}: {
  at: string | null;
  overdue: boolean;
}) {
  if (!at) return <span className="text-slate-400">—</span>;
  return (
    <span
      className={`whitespace-nowrap ${overdue ? 'text-amber-700' : 'text-slate-600'}`}
    >
      {new Date(at).toLocaleDateString()}
      {overdue && ' · over a day'}
    </span>
  );
}
