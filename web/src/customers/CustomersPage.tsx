import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Button } from '../components/Button';
import { Field, Input, Select } from '../components/Field';
import { Money } from '../components/Money';
import { api, ApiError } from '../api/client';
import { useSeesCost } from '../auth/useAuth';
import type { components } from '../api/schema';

type CustomerView = components['schemas']['CustomerView'];
type PriceTierView = components['schemas']['PriceTierView'];
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
                <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            )}

            {!isPending && customers.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
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

/**
 * Adding a customer, mid-transaction, with a queue waiting.
 *
 * Only `firstName` is required, and that is the market rather than laziness: a
 * customer here is often a shop known by one name and a phone number. Demanding
 * a surname or an address means the row never gets created and the debt is
 * never tracked.
 */
function CustomerDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [priceTierId, setPriceTierId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: tiers = [] } = useQuery({
    queryKey: ['price-tiers'],
    queryFn: () => api.get<PriceTierView[]>('/price-tiers'),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<CustomerView>('/customers', {
        id: crypto.randomUUID(),
        firstName: firstName.trim(),
        ...(lastName.trim() && { lastName: lastName.trim() }),
        ...(phone.trim() && { phone: phone.trim() }),
        ...(email.trim() && { email: email.trim() }),
        ...(priceTierId && { priceTierId }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
      onClose();
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not save that customer.',
      ),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (firstName.trim()) create.mutate();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="customer-title"
    >
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-lg"
      >
        <h2
          id="customer-title"
          className="text-lg font-semibold text-slate-900"
        >
          Add a customer
        </h2>

        <div className="mt-4 space-y-4">
          <Field label="Name" htmlFor="first-name">
            <Input
              id="first-name"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              autoFocus
              required
            />
          </Field>

          <Field
            label="Surname"
            htmlFor="last-name"
            hint="Optional — plenty of customers are known by one name."
          >
            <Input
              id="last-name"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
            />
          </Field>

          <Field
            label="Phone"
            htmlFor="phone"
            hint="Worth having: chasing a debt is a phone call."
          >
            <Input
              id="phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+234…"
            />
          </Field>

          <Field label="Email" htmlFor="email">
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>

          <Field
            label="Price list"
            htmlFor="tier"
            hint="What they are charged. Blank uses the default."
          >
            <Select
              id="tier"
              value={priceTierId}
              onChange={(event) => setPriceTierId(event.target.value)}
            >
              <option value="">Default</option>
              {tiers.map((tier) => (
                <option key={tier.id} value={tier.id}>
                  {tier.name}
                </option>
              ))}
            </Select>
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
            onClick={onClose}
            disabled={create.isPending}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={create.isPending || !firstName.trim()}
          >
            {create.isPending ? 'Saving…' : 'Add customer'}
          </Button>
        </div>
      </form>
    </div>
  );
}
