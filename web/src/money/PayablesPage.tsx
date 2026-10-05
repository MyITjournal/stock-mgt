import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Money } from '../components/Money';
import { Button } from '../components/Button';
import { Field, Select } from '../components/Field';
import { PaidStatus } from '../components/PaidStatus';
import { api } from '../api/client';
import type { components } from '../api/schema';
import { PaySupplierDialog } from './PaySupplierDialog';
import { usePaySupplier } from './usePaySupplier';
import { BillDialog } from './BillDialog';

type PayablesView = components['schemas']['PayablesView'];
type SupplierBillView = components['schemas']['SupplierBillView'];
type SupplierView = components['schemas']['SupplierView'];

/**
 * Bills: what the business owes its vendors, and what it has paid them.
 *
 * Called *We owe* until 2026-10-05. Two views of the same bills:
 *
 * - **Unpaid** — `GET /payables`, grouped per vendor, longest owed first.
 *   The phone call to make.
 * - **All bills** — `GET /supplier-bills`, paid ones included, each marked
 *   Unpaid, Part-paid or Paid. Before this a fully paid bill vanished, and
 *   there was nowhere to check that what went out matched what was billed.
 *
 * The two sides look symmetrical and are not (DECISIONS.md §16). A customer
 * payment spreads across invoices; a vendor payment settles **exactly one
 * bill**, because vendors are paid on delivery or against one specific
 * supply. So paying starts from a bill, never from a vendor, and "Mark as
 * paid" is simply a payment for the whole balance of that bill.
 */
export function PayablesPage() {
  const [view, setView] = useState<'unpaid' | 'all'>('unpaid');
  const [opened, setOpened] = useState<string | null>(null);
  const [paying, setPaying] = useState<{
    billId: string;
    full: boolean;
  } | null>(null);
  const { pay, error, clearError } = usePaySupplier(() => setPaying(null));

  return (
    <Page
      title="Bills"
      description="What you owe your vendors, and what you have paid them."
    >
      <div className="mb-6 inline-flex rounded-lg border border-slate-200 bg-white p-1 text-sm">
        {(
          [
            ['unpaid', 'Unpaid'],
            ['all', 'All bills'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setView(key)}
            className={`rounded-md px-3 py-1.5 ${
              view === key
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'unpaid' ? (
        <UnpaidBills
          onOpen={setOpened}
          onPay={(billId, full) => setPaying({ billId, full })}
        />
      ) : (
        <AllBills onOpen={setOpened} />
      )}

      {opened && <BillDialog billId={opened} onClose={() => setOpened(null)} />}

      {paying && (
        <PaySupplierDialog
          billId={paying.billId}
          payInFull={paying.full}
          busy={pay.isPending}
          error={error}
          onCancel={() => {
            setPaying(null);
            clearError();
          }}
          onConfirm={(draft) => pay.mutate(draft)}
        />
      )}
    </Page>
  );
}

function UnpaidBills({
  onOpen,
  onPay,
}: {
  onOpen: (billId: string) => void;
  onPay: (billId: string, full: boolean) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data, isPending } = useQuery({
    queryKey: ['payables'],
    queryFn: () => api.get<PayablesView>('/payables'),
  });

  return (
    <>
      {data && (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <Tile label="Unpaid bills" value={<Money value={data.total} />} big />
          <Tile
            label="Vendors owed"
            value={String(data.suppliers)}
            hint={
              data.oldestDays === null
                ? undefined
                : `oldest ${data.oldestDays} days`
            }
          />
          <Tile
            label="Past the agreed date"
            value={<Money value={data.overdue} />}
            hint="Only bills that were given a date."
            tone={data.overdue > 0 ? 'warn' : undefined}
          />
        </div>
      )}

      {isPending && <p className="text-sm text-slate-500">Loading…</p>}

      {data?.bySupplier.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">
          No unpaid bills.
        </div>
      )}

      <div className="space-y-3">
        {data?.bySupplier.map((group) => {
          const bills = data.bills.filter(
            (bill) => bill.supplier.id === group.supplier.id,
          );
          const open = expanded === group.supplier.id;

          return (
            <div
              key={group.supplier.id}
              className="overflow-hidden rounded-lg border border-slate-200 bg-white"
            >
              <button
                type="button"
                onClick={() => setExpanded(open ? null : group.supplier.id)}
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
              >
                <span>
                  <span className="font-medium text-slate-900">
                    {group.supplier.name}
                  </span>
                  {group.supplier.phone && (
                    <span className="ml-2 text-xs text-slate-500">
                      {group.supplier.phone}
                    </span>
                  )}
                  <span className="ml-2 text-xs text-slate-500">
                    {group.bills} bill{group.bills === 1 ? '' : 's'} · oldest{' '}
                    {group.oldestDays}d
                  </span>
                </span>
                <span className="font-semibold text-slate-900">
                  <Money value={group.balance} />
                </span>
              </button>

              {open && (
                <table className="w-full border-t border-slate-100 text-sm">
                  <tbody className="divide-y divide-slate-50">
                    {bills.map((bill) => (
                      <tr key={bill.id}>
                        <td className="px-4 py-2">
                          <button
                            type="button"
                            onClick={() => onOpen(bill.id)}
                            className="text-slate-900 underline-offset-2 hover:underline"
                          >
                            {bill.invoiceNumber ?? 'No invoice number'}
                          </button>
                          <span className="ml-2 text-xs text-slate-500">
                            {new Date(bill.issuedAt).toLocaleDateString(
                              'en-NG',
                            )}{' '}
                            · {bill.daysOutstanding}d
                          </span>
                          {bill.daysUntilDue !== null &&
                            bill.daysUntilDue < 0 && (
                              <span className="ml-2 text-xs text-amber-700">
                                {Math.abs(bill.daysUntilDue)}d overdue
                              </span>
                            )}
                        </td>
                        <td className="px-4 py-2 text-right text-slate-500">
                          <Money value={bill.amountDue} />
                        </td>
                        <td className="px-4 py-2 text-right font-medium">
                          <Money value={bill.balance} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 text-right">
                          <Button
                            variant="ghost"
                            onClick={() => onPay(bill.id, false)}
                          >
                            Pay part
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => onPay(bill.id, true)}
                          >
                            Mark as paid
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/**
 * Every bill, paid ones included, newest first.
 *
 * Billed, paid and owing are the server's figures for each bill — `paid` is
 * the sum of the payments that count against it — so a row and the bill it
 * opens always agree.
 */
function AllBills({ onOpen }: { onOpen: (billId: string) => void }) {
  const [supplierId, setSupplierId] = useState('');

  const { data: bills = [], isPending } = useQuery({
    queryKey: ['supplier-bills', supplierId],
    queryFn: () =>
      api.get<SupplierBillView[]>(
        `/supplier-bills${supplierId ? `?supplierId=${supplierId}` : ''}`,
      ),
  });
  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api.get<SupplierView[]>('/suppliers'),
  });

  // The server lists oldest first, for the debt-chasing view; a record of
  // what was billed reads newest first. Ordering only — nothing is summed.
  const rows = [...bills].reverse();

  return (
    <>
      <div className="mb-4 max-w-xs">
        <Field label="Vendor" htmlFor="bills-supplier">
          <Select
            id="bills-supplier"
            value={supplierId}
            onChange={(event) => setSupplierId(event.target.value)}
          >
            <option value="">Everyone</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {isPending && <p className="text-sm text-slate-500">Loading…</p>}

      {!isPending && rows.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">
          No bills yet. Recording a delivery raises one.
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Billed on</th>
                <th className="px-4 py-2 font-medium">Vendor</th>
                <th className="px-4 py-2 font-medium">Invoice</th>
                <th className="px-4 py-2 text-right font-medium">Billed</th>
                <th className="px-4 py-2 text-right font-medium">Paid</th>
                <th className="px-4 py-2 text-right font-medium">Owing</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((bill) => (
                <tr
                  key={bill.id}
                  onClick={() => onOpen(bill.id)}
                  className="cursor-pointer hover:bg-slate-50"
                >
                  <td className="whitespace-nowrap px-4 py-2 text-slate-600">
                    {new Date(bill.issuedAt).toLocaleDateString('en-NG')}
                  </td>
                  <td className="px-4 py-2 font-medium text-slate-900">
                    {bill.supplier.name}
                  </td>
                  <td className="px-4 py-2">
                    {bill.invoiceNumber ?? (
                      <span className="text-slate-400">no number</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Money value={bill.amountDue} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Money value={bill.paid} />
                  </td>
                  <td className="px-4 py-2 text-right font-medium">
                    <Money value={bill.balance} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <PaidStatus balance={bill.balance} paid={bill.paid} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Tile({
  label,
  value,
  hint,
  big,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  big?: boolean;
  tone?: 'warn';
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div
        className={`mt-1 font-semibold ${big ? 'text-3xl' : 'text-2xl'} ${
          tone === 'warn' ? 'text-amber-700' : 'text-slate-900'
        }`}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}
