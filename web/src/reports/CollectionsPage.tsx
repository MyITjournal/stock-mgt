import { useQuery } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Money } from '../components/Money';
import { api } from '../api/client';
import type { components } from '../api/schema';
import { PeriodPicker } from './PeriodPicker';
import { usePeriodQuery } from './usePeriodQuery';

type CollectionsView = components['schemas']['CollectionsView'];
type ProfitReportView = components['schemas']['ProfitReportView'];

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  transfer: 'Transfer',
  pos: 'POS',
  cheque: 'Cheque',
};

/**
 * Money actually received — the end-of-shift cash-up.
 *
 * **Deliberately not the same number as sales**, and this screen shows both so
 * the difference is visible rather than surprising. On a credit route they
 * diverge, and the gap *is* the cash position: what was sold that nobody has
 * paid for yet.
 *
 * `byLocation` is what each counter or van took, which is the question
 * `Payment.locationId` exists to answer (DECISIONS.md §11), and `byBankAccount`
 * is the reconciliation view — one row to lay beside each bank statement.
 *
 * Voided payments are excluded throughout: a void says the money never moved.
 */
export function CollectionsPage() {
  const { query } = usePeriodQuery();

  const { data, isPending } = useQuery({
    queryKey: ['reports', 'collections', query],
    queryFn: () => api.get<CollectionsView>(`/reports/collections?${query}`),
  });

  // Read alongside, so "collected" can be laid against "sold" over the same
  // window. The two answer different questions and the gap is the point.
  const { data: profit } = useQuery({
    queryKey: ['reports', 'profit', query],
    queryFn: () => api.get<ProfitReportView>(`/reports/profit?${query}`),
  });

  return (
    <Page
      title="Money in"
      description="What was actually received, per till and per account."
    >
      <PeriodPicker resolved={profit?.period} />

      {isPending && <p className="text-sm text-slate-500">Loading…</p>}

      {data && (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-900 bg-slate-900 p-4 text-white">
              <div className="text-xs uppercase text-slate-300">Collected</div>
              <div className="mt-1 text-2xl font-semibold">
                <Money value={data.total} />
              </div>
              <div className="mt-1 text-xs text-slate-300">
                {data.count} payment{data.count === 1 ? '' : 's'}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="text-xs uppercase text-slate-500">
                Sold, with VAT
              </div>
              <div className="mt-1 text-2xl font-semibold text-slate-900">
                <Money value={profit?.grossSales} />
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Not the same question
              </div>
            </div>

            {/* Deliberately not a third figure subtracting one from the
                other. Money is displayed, never computed here — and that
                subtraction would be *wrong* as well as against the rule:
                collections in this window include payments against invoices
                from months ago, so the difference is not "credit given". What
                is still owed is a question `/receivables` answers properly. */}
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-4">
              <div className="text-xs uppercase text-slate-500">
                Why they differ
              </div>
              <p className="mt-1 text-sm text-slate-600">
                Collections include money paid on older invoices, and exclude
                credit given this window. What is still owed is on{' '}
                <strong>Money → Owed to us</strong>.
              </p>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Breakdown
              title="How it came in"
              rows={data.byMethod.map((row) => ({
                key: row.method,
                label: METHOD_LABELS[row.method] ?? row.method,
                total: row.total,
              }))}
              empty="Nothing was collected in this window."
            />

            <Breakdown
              title="Which till"
              rows={data.byLocation.map((row) => ({
                key: row.locationId,
                label: row.label,
                total: row.total,
                count: row.count,
              }))}
              empty="Nothing was collected in this window."
              note="Money belonging to no counter — a transfer landing in the bank — gets its own row rather than being dropped."
            />

            <Breakdown
              title="Which account"
              rows={data.byBankAccount.map((row) => ({
                key: row.bankAccountId ?? 'cash',
                label: row.label,
                total: row.total,
                count: row.count,
              }))}
              empty="Nothing was collected in this window."
              note="Lay each row beside that account's statement for the same dates."
            />
          </div>
        </>
      )}
    </Page>
  );
}

function Breakdown({
  title,
  rows,
  empty,
  note,
}: {
  title: string;
  rows: { key: string; label: string; total: number; count?: number }[];
  empty: string;
  note?: string;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">
        {title}
      </h2>

      {rows.length === 0 ? (
        <p className="p-4 text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((row) => (
            <li
              key={row.key}
              className="flex items-baseline justify-between gap-4 px-4 py-3"
            >
              <span className="text-sm text-slate-700">
                {row.label}
                {row.count !== undefined && (
                  <span className="block text-xs text-slate-400">
                    {row.count} payment{row.count === 1 ? '' : 's'}
                  </span>
                )}
              </span>
              <span className="text-sm text-slate-900">
                <Money value={row.total} />
              </span>
            </li>
          ))}
        </ul>
      )}

      {note && (
        <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          {note}
        </p>
      )}
    </section>
  );
}
