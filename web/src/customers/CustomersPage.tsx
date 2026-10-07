import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Button } from '../components/Button';
import { Money } from '../components/Money';
import { api } from '../api/client';
import { useSeesCost } from '../auth/useAuth';
import type { components } from '../api/schema';
import { Field, Input } from '../components/Field';
import { SortHeading } from '../components/SortHeading';
import { sortRows, useSort, type SortValue } from '../lib/sort';
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
  const navigate = useNavigate();
  const seesCost = useSeesCost();
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const { sort, toggle } = useSort();

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
  const nameOf = (customer: CustomerView) =>
    [customer.firstName, customer.lastName].filter(Boolean).join(' ');

  // The whole list is on screen, so it is searched and sorted here (2026-10-07).
  const term = search.trim().toLowerCase();
  const matching = term
    ? customers.filter((customer) =>
        [nameOf(customer), customer.phone, customer.email]
          .filter(Boolean)
          .some((field) => field!.toLowerCase().includes(term)),
      )
    : customers;
  const sortValue: Record<string, (customer: CustomerView) => SortValue> = {
    name: nameOf,
    owes: (customer) => balanceFor(customer.id),
  };
  const shown = sort
    ? sortRows(matching, sortValue[sort.key], sort.direction)
    : matching;

  return (
    <Page
      title="Customers"
      description="Everyone the business sells to on account."
      actions={<Button onClick={() => setAdding(true)}>Add customer</Button>}
    >
      <div className="mb-4 max-w-sm">
        <Field label="Search" htmlFor="customer-search">
          <Input
            id="customer-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, phone or email"
          />
        </Field>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <SortHeading
                label="Name"
                sortKey="name"
                sort={sort}
                onToggle={toggle}
              />
              <th className="px-4 py-2 font-medium">Phone</th>
              <th className="px-4 py-2 font-medium">Email</th>
              {seesCost && (
                <SortHeading
                  label="Owes"
                  sortKey="owes"
                  sort={sort}
                  onToggle={toggle}
                  numeric
                />
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

            {!isPending && customers.length > 0 && shown.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  Nobody matches that.
                </td>
              </tr>
            )}

            {shown.map((customer) => {
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

      {adding && (
        <CustomerDialog
          onClose={() => setAdding(false)}
          // Already a customer: open them rather than add a second.
          onPickExisting={(customer) => navigate(`/customers/${customer.id}`)}
        />
      )}
    </Page>
  );
}
