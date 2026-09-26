import { useQuery } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Money } from '../components/Money';
import { DataTable, type Column } from '../components/DataTable';
import { api } from '../api/client';
import type { components } from '../api/schema';
import { PeriodPicker } from './PeriodPicker';
import { usePeriodQuery } from './usePeriodQuery';

type PurchasesReportView = components['schemas']['PurchasesReportView'];
type PurchaseGroupRow = components['schemas']['PurchaseGroupRow'];

/**
 * What the business bought, and from whom.
 *
 * Summed from goods receipt lines, which have been accumulating since the
 * ledger existed — so this report is correct for months that happened long
 * before anybody asked for it.
 *
 * Two things on every row are deliberately separate figures. **Received** is
 * what came off the lorry; **paid for** is what the invoice charged, and the
 * gap between them is free goods. Showing only one would either overstate what
 * was bought or hide what was given (DECISIONS.md §16).
 *
 * Value is the exact invoice total, never `costPrice × quantity` — a rounded
 * average would drift from the vendor's own sheet by a few kobo a line, which
 * is what makes a dispute unwinnable.
 */
export function PurchasesPage() {
  const { query } = usePeriodQuery();

  const { data, isPending } = useQuery({
    queryKey: ['reports', 'purchases', query],
    queryFn: () => api.get<PurchasesReportView>(`/reports/purchases?${query}`),
  });

  const columns: readonly Column<PurchaseGroupRow>[] = [
    { header: 'Name', cell: (row) => row.label },
    {
      header: 'Value',
      numeric: true,
      cell: (row) => <Money value={row.value} />,
    },
    {
      header: 'Received',
      numeric: true,
      cell: (row) => <span className="tabular-nums">{row.quantityReceived}</span>,
    },
    {
      header: 'Paid for',
      numeric: true,
      cell: (row) => (
        <span className="tabular-nums">
          {row.quantityPaidFor}
          {row.quantityReceived > row.quantityPaidFor && (
            <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
              +{row.quantityReceived - row.quantityPaidFor} free
            </span>
          )}
        </span>
      ),
    },
    { header: 'Lines', numeric: true, cell: (row) => row.lines },
  ];

  return (
    <Page
      title="Purchases"
      description="What arrived, from whom, at what the invoices said."
    >
      <PeriodPicker resolved={data?.period} />

      {isPending && <p className="text-sm text-slate-500">Loading…</p>}

      {data && (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="Bought" value={<Money value={data.total} />} />
            <Stat label="Deliveries" value={data.deliveries} />
            <Stat label="Vendors" value={data.suppliers} />
            <Stat label="Units received" value={data.unitsReceived} />
            <Stat
              label="Of those, free"
              value={data.unitsFree}
              note={data.unitsFree > 0 ? 'Not charged for' : undefined}
            />
          </div>

          <Section title="By vendor">
            <DataTable
              rows={data.bySupplier}
              columns={columns}
              rowKey={(row) => row.key}
              empty="Nothing arrived in this window."
            />
          </Section>

          <Section title="By category">
            <DataTable
              rows={data.byCategory}
              columns={columns}
              rowKey={(row) => row.key}
              empty="Nothing arrived in this window."
            />
          </Section>

          <Section title="Most bought">
            <DataTable
              rows={data.topProducts}
              columns={columns}
              rowKey={(row) => row.key}
              empty="Nothing arrived in this window."
            />
          </Section>
        </>
      )}
    </Page>
  );
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: React.ReactNode;
  note?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-slate-900">{value}</div>
      {note && <div className="mt-1 text-xs text-slate-500">{note}</div>}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}
