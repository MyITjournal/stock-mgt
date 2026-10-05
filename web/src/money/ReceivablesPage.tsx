import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Money } from '../components/Money';
import { Button } from '../components/Button';
import { Field, Select } from '../components/Field';
import { PaidStatus } from '../components/PaidStatus';
import { api } from '../api/client';
import type { components } from '../api/schema';
import {
  RecordPaymentDialog,
  type InvoiceToSettle,
} from './RecordPaymentDialog';
import { useRecordPayment } from './useRecordPayment';

type ReceivablesView = components['schemas']['ReceivablesView'];
type SaleListView = components['schemas']['SaleListView'];
type CustomerView = components['schemas']['CustomerView'];

const PAGE = 50;

/**
 * Invoices: what customers owe, and what they have paid.
 *
 * Called *Owed to us* until 2026-10-05. Two views:
 *
 * - **Unpaid** — `GET /receivables`, per customer, longest owed first.
 *   **A sorted list, not 30/60/90 buckets**: the question people here ask is
 *   who has owed longest, and that is a sort (DECISIONS.md §5). Grouped per
 *   customer, because chasing a debt is a phone call to a person.
 * - **All invoices** — `GET /sales` newest first, each marked Unpaid,
 *   Part-paid or Paid from the server's own `balance` and `allocated`.
 *
 * **Mark as paid** records a payment for exactly that invoice, for what it
 * still owes. It is the ordinary payment form with the invoice already
 * chosen — the method and account are still asked, never guessed (§11).
 */
export function ReceivablesPage() {
  const [view, setView] = useState<'unpaid' | 'all'>('unpaid');
  // '' opens the form with no customer chosen; an id opens it for them.
  const [paying, setPaying] = useState<string | null>(null);
  const [settling, setSettling] = useState<InvoiceToSettle | null>(null);
  const { record, error, clearError } = useRecordPayment(() => {
    setPaying(null);
    setSettling(null);
  });

  const close = () => {
    setPaying(null);
    setSettling(null);
    clearError();
  };

  return (
    <Page
      title="Invoices"
      description="What customers owe you, and what they have paid."
      actions={<Button onClick={() => setPaying('')}>Record a payment</Button>}
    >
      <div className="mb-6 inline-flex rounded-lg border border-slate-200 bg-white p-1 text-sm">
        {(
          [
            ['unpaid', 'Unpaid'],
            ['all', 'All invoices'],
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
        <UnpaidInvoices onPayCustomer={setPaying} onMarkPaid={setSettling} />
      ) : (
        <AllInvoices onMarkPaid={setSettling} />
      )}

      {(paying !== null || settling) && (
        <RecordPaymentDialog
          customerId={paying || undefined}
          invoice={settling ?? undefined}
          busy={record.isPending}
          error={error}
          onCancel={close}
          onConfirm={(draft) => record.mutate(draft)}
        />
      )}
    </Page>
  );
}

function UnpaidInvoices({
  onPayCustomer,
  onMarkPaid,
}: {
  onPayCustomer: (customerId: string) => void;
  onMarkPaid: (invoice: InvoiceToSettle) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data, isPending } = useQuery({
    queryKey: ['receivables'],
    queryFn: () => api.get<ReceivablesView>('/receivables'),
  });

  return (
    <>
      {data && (
        <div className="mb-6 rounded-lg border border-slate-200 bg-white p-5">
          <div className="text-xs uppercase tracking-wide text-slate-500">
            Total outstanding
          </div>
          <div className="mt-1 text-3xl font-semibold text-slate-900">
            <Money value={data.totalOutstanding} />
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Money owed back to a customer is excluded rather than netted off —
            the two are different problems. This is exactly what the rows below
            add up to.
          </p>

          {/*
            Shown whenever it exists, because excluding it from the headline
            is only honest if it appears somewhere. It used to be subtracted
            from a customer's row instead, which made the breakdown disagree
            with the total and hid the credit in the same stroke.
          */}
          {data.totalCredit > 0 && (
            <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              <strong>
                <Money value={data.totalCredit} />
              </strong>{' '}
              is owed <strong>back</strong> — goods returned after an invoice
              was paid, or money taken twice. It is not subtracted from the
              figure above.
            </p>
          )}
        </div>
      )}

      {isPending && <p className="text-sm text-slate-500">Loading…</p>}

      {data?.byCustomer.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">
          Nobody owes anything.
        </div>
      )}

      <div className="space-y-3">
        {data?.byCustomer.map((group) => {
          const key = group.customer?.id ?? 'walk-in';
          const name = group.customer
            ? [group.customer.firstName, group.customer.lastName]
                .filter(Boolean)
                .join(' ')
            : 'Walk-in';
          const invoices = data.invoices.filter(
            (invoice) => (invoice.customer?.id ?? 'walk-in') === key,
          );

          return (
            <div
              key={key}
              className="overflow-hidden rounded-lg border border-slate-200 bg-white"
            >
              <button
                type="button"
                onClick={() =>
                  setExpanded((current) => (current === key ? null : key))
                }
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
              >
                <span>
                  <span className="font-medium text-slate-900">{name}</span>
                  {group.customer?.phone && (
                    <a
                      href={`tel:${group.customer.phone}`}
                      onClick={(event) => event.stopPropagation()}
                      className="ml-2 text-xs text-slate-500 underline underline-offset-2"
                    >
                      {group.customer.phone}
                    </a>
                  )}
                  <span className="ml-2 text-xs text-slate-500">
                    {group.invoices} invoice{group.invoices === 1 ? '' : 's'} ·
                    oldest {group.oldestDays}d
                  </span>
                </span>
                <span className="text-right">
                  <span className="font-semibold text-slate-900">
                    <Money value={group.balance} signed />
                  </span>
                  {group.credit > 0 && (
                    <span className="block text-xs text-amber-700">
                      <Money value={group.credit} /> owed back
                    </span>
                  )}
                </span>
              </button>

              {expanded === key && (
                <div className="border-t border-slate-100">
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-slate-50">
                      {invoices.map((invoice) => (
                        <tr key={invoice.id}>
                          <td className="px-4 py-2">
                            <Link
                              to={`/sales/${invoice.id}`}
                              className="text-slate-900 underline-offset-2 hover:underline"
                            >
                              {invoice.number}
                            </Link>
                            <span className="ml-2 text-xs text-slate-500">
                              {new Date(invoice.occurredAt).toLocaleDateString(
                                'en-NG',
                              )}{' '}
                              · {invoice.daysOutstanding}d
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right text-slate-500">
                            <Money value={invoice.total} />
                          </td>
                          <td className="px-4 py-2 text-right font-medium">
                            <Money value={invoice.balance} signed />
                          </td>
                          <td className="px-4 py-2 text-right">
                            {invoice.customer && invoice.balance > 0 && (
                              <Button
                                variant="secondary"
                                onClick={() =>
                                  onMarkPaid({
                                    saleId: invoice.id,
                                    number: invoice.number,
                                    customerId: invoice.customer!.id,
                                    balance: invoice.balance,
                                  })
                                }
                              >
                                Mark as paid
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {group.customer && (
                    <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-2">
                      <Link
                        to={`/customers/${group.customer.id}`}
                        className="text-xs text-slate-500 underline underline-offset-2"
                      >
                        Statement
                      </Link>
                      <button
                        type="button"
                        onClick={() => onPayCustomer(group.customer!.id)}
                        className="text-xs font-medium text-slate-900 underline underline-offset-2"
                      >
                        Record a payment
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/**
 * Every invoice, newest first, paged by cursor like Sales. The status is read
 * from the server's `balance` and `allocated`, never worked out here.
 */
function AllInvoices({
  onMarkPaid,
}: {
  onMarkPaid: (invoice: InvoiceToSettle) => void;
}) {
  const [customerId, setCustomerId] = useState('');
  const [pages, setPages] = useState<string[]>([]);
  const cursor = pages.at(-1);

  const query = new URLSearchParams({ order: 'desc', limit: String(PAGE) });
  if (customerId) query.set('customerId', customerId);
  if (cursor) query.set('cursor', cursor);

  const { data, isPending } = useQuery({
    queryKey: ['sales', query.toString()],
    queryFn: () => api.get<SaleListView>(`/sales?${query}`),
  });
  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => api.get<CustomerView[]>('/customers'),
  });

  const sales = data?.sales ?? [];

  return (
    <>
      <div className="mb-4 max-w-xs">
        <Field label="Customer" htmlFor="invoices-customer">
          <Select
            id="invoices-customer"
            value={customerId}
            onChange={(event) => {
              setCustomerId(event.target.value);
              setPages([]);
            }}
          >
            <option value="">Everyone</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {[customer.firstName, customer.lastName]
                  .filter(Boolean)
                  .join(' ')}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {isPending && <p className="text-sm text-slate-500">Loading…</p>}

      {!isPending && sales.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">
          No invoices yet.
        </div>
      )}

      {sales.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Invoice</th>
                <th className="px-4 py-2 font-medium">Customer</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
                <th className="px-4 py-2 text-right font-medium">Paid</th>
                <th className="px-4 py-2 text-right font-medium">Owing</th>
                <th className="px-4 py-2 font-medium" />
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sales.map((sale) => (
                <tr key={sale.id}>
                  <td className="whitespace-nowrap px-4 py-2 text-slate-600">
                    {new Date(sale.occurredAt).toLocaleDateString('en-NG')}
                  </td>
                  <td className="px-4 py-2">
                    <Link
                      to={`/sales/${sale.id}`}
                      className="font-medium text-slate-900 underline-offset-2 hover:underline"
                    >
                      {sale.number}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    {sale.customer
                      ? [sale.customer.firstName, sale.customer.lastName]
                          .filter(Boolean)
                          .join(' ')
                      : 'Walk-in'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Money value={sale.total} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Money value={sale.allocated} />
                  </td>
                  <td className="px-4 py-2 text-right font-medium">
                    <Money value={sale.balance} signed />
                  </td>
                  <td className="px-4 py-2">
                    <PaidStatus balance={sale.balance} paid={sale.allocated} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    {sale.customer && sale.balance > 0 && (
                      <Button
                        variant="secondary"
                        onClick={() =>
                          onMarkPaid({
                            saleId: sale.id,
                            number: sale.number,
                            customerId: sale.customer!.id,
                            balance: sale.balance,
                          })
                        }
                      >
                        Mark as paid
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between">
        <Button
          variant="secondary"
          disabled={pages.length === 0}
          onClick={() => setPages((current) => current.slice(0, -1))}
        >
          Newer
        </Button>
        <span className="text-xs text-slate-500">
          {pages.length > 0 && `Page ${pages.length + 1}`}
        </span>
        <Button
          variant="secondary"
          disabled={!data?.nextCursor}
          onClick={() =>
            data?.nextCursor &&
            setPages((current) => [...current, data.nextCursor!])
          }
        >
          Older
        </Button>
      </div>
    </>
  );
}
