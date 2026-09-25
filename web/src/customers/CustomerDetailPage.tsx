import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Money } from '../components/Money';
import { PdfButton } from '../components/PdfButton';
import { api } from '../api/client';
import { useSeesCost } from '../auth/useAuth';
import type { components } from '../api/schema';

type CustomerView = components['schemas']['CustomerView'];
type StatementView = components['schemas']['StatementView'];

/**
 * One customer's position: what they owe, what they have paid, how long each
 * invoice has been outstanding.
 *
 * **It lists payments as well as debts on purpose.** A statement showing only
 * what is owed reads as an accusation and invites a dispute about money that
 * was in fact received (DECISIONS.md §6). The PDF renders this same payload —
 * it recomputes nothing — so print and screen cannot disagree.
 *
 * Invoices are oldest first, which is the sort the whole receivables feature is
 * built around: the question people ask is who has owed longest, not which
 * 30/60/90 bucket a debt falls in (§5).
 */
export function CustomerDetailPage() {
  const { id = '' } = useParams();
  const seesCost = useSeesCost();

  const { data: customer } = useQuery({
    queryKey: ['customer', id],
    queryFn: () => api.get<CustomerView>(`/customers/${id}`),
  });

  const { data: statement, isPending } = useQuery({
    queryKey: ['statement', id],
    queryFn: () => api.get<StatementView>(`/customers/${id}/statement`),
    enabled: seesCost,
  });

  const name = customer
    ? [customer.firstName, customer.lastName].filter(Boolean).join(' ')
    : 'Customer';

  return (
    <Page
      title={name}
      description={customer?.phone ?? undefined}
      actions={
        seesCost ? (
          <PdfButton
            path={`/customers/${id}/statement.pdf`}
            label="Statement PDF"
          />
        ) : undefined
      }
    >
      {!seesCost && (
        <p className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Statements are closed to your role.
        </p>
      )}

      {seesCost && isPending && (
        <p className="text-sm text-slate-500">Loading…</p>
      )}

      {statement && (
        <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
          <div className="space-y-6">
            <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <h2 className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs uppercase tracking-wide text-slate-500">
                Invoices with money on them — longest owed first
              </h2>
              {statement.invoices.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-slate-500">
                  Nothing outstanding.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-slate-100">
                    {statement.invoices.map((invoice) => (
                      <tr key={invoice.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <Link
                            to={`/sales/${invoice.id}`}
                            className="font-medium text-slate-900 underline-offset-2 hover:underline"
                          >
                            {invoice.number}
                          </Link>
                          <div className="text-xs text-slate-500">
                            {new Date(invoice.occurredAt).toLocaleDateString(
                              'en-NG',
                            )}{' '}
                            · {invoice.daysOutstanding} days
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-slate-500">
                          <Money value={invoice.total} />
                        </td>
                        <td className="px-4 py-3 text-right font-medium">
                          <Money value={invoice.balance} signed />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <h2 className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs uppercase tracking-wide text-slate-500">
                Payments received
              </h2>
              {statement.payments.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-slate-500">
                  No payments recorded.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {statement.payments.map((payment) => (
                    <li
                      key={payment.id}
                      className="flex items-center justify-between px-4 py-3"
                    >
                      <span>
                        <span className="text-slate-900">{payment.method}</span>
                        <span className="ml-2 text-xs text-slate-500">
                          {new Date(payment.occurredAt).toLocaleDateString(
                            'en-NG',
                          )}
                          {payment.reference ? ` · ${payment.reference}` : ''}
                        </span>
                      </span>
                      <Money value={payment.amount} signed />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <aside className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500">
                Owes
              </div>
              <div className="mt-1 text-2xl font-semibold text-slate-900">
                <Money value={statement.owed} signed />
              </div>
              {statement.credit !== 0 && (
                <div className="mt-3 border-t border-slate-100 pt-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Credit held</span>
                    <Money value={statement.credit} />
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    Money received that no invoice has claimed yet.
                  </p>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </Page>
  );
}
