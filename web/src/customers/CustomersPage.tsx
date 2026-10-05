import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Button } from '../components/Button';
import { Money } from '../components/Money';
import { api } from '../api/client';
import { useSeesCost } from '../auth/useAuth';
import type { components } from '../api/schema';
import { CustomerDialog } from './CustomerDialog';

type CustomerView = components['schemas']['CustomerView'];
type ReceivablesView = components['schemas']['ReceivablesView'];

/**
 * The customer list, with what each one owes beside them.
 *
 * The balance comes from `GET /receivables` rather than being counted here —
 * what an invoice still owes is `total − allocated − refunded`, defined once on
 * the server in `balance.ts`, and a second implementation in a browser is
 * exactly how a list comes to disagree with the statement it links to
 * (DECISIONS.md §5).
 *
 * Receivables is closed to a rep, so the column is only fetched for roles that
 * may read it. The list itself is open to everyone — a rep needs to know who
 * they are selling to.
 */
export function CustomersPage() {
  const seesCost = useSeesCost();
  const [adding, setAdding] = useState(false);

  const { data: customers = [], isPending } = useQuery({
    queryKey: ['customers'],
    queryFn: () => api.get<CustomerView[]>('/customers'),
  });

  const { data: owed } = useQuery({
    queryKey: ['receivables'],
    queryFn: () => api.get<ReceivablesView>('/receivables'),
    enabled: seesCost,
  });

  const balanceFor = (customerId: string) =>
    owed?.byCustomer.find((group) => group.customer?.id === customerId)
      ?.balance;

  return (
    <Page
      title="Customers"
      description="Everyone the business sells to on account."
      actions={<Button onClick={() => setAdding(true)}>Add customer</Button>}
    >
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Phone</th>
              <th className="px-4 py-2 font-medium">Email</th>
              {seesCost && (
                <th className="px-4 py-2 text-right font-medium">Owes</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isPending && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  Loading…
                </td>
              </tr>
            )}

            {!isPending && customers.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  No customers yet. Walk-in sales do not need one.
                </td>
              </tr>
            )}

            {customers.map((customer) => {
              const balance = balanceFor(customer.id);
              return (
                <tr key={customer.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      to={`/customers/${customer.id}`}
                      className="font-medium text-slate-900 underline-offset-2 hover:underline"
                    >
                      {[customer.firstName, customer.lastName]
                        .filter(Boolean)
                        .join(' ')}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {customer.phone ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {customer.email ?? '—'}
                  </td>
                  {seesCost && (
                    <td className="px-4 py-3 text-right">
                      {balance ? (
                        <Money value={balance} signed />
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {adding && <CustomerDialog onClose={() => setAdding(false)} />}
    </Page>
  );
}
