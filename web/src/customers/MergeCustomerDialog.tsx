import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DialogClose } from '../components/DialogClose';
import { Button } from '../components/Button';
import { Field, Input } from '../components/Field';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import type { components } from '../api/schema';

type CustomerView = components['schemas']['CustomerView'];
type CustomerMergeView = components['schemas']['CustomerMergeView'];

const nameOf = (customer: CustomerView) =>
  [customer.firstName, customer.lastName].filter(Boolean).join(' ');

/**
 * Folding a customer entered twice into the one that stays (2026-10-07).
 *
 * Opened from the duplicate's page. You pick who stays — the list starts with
 * the customers whose name matches, since that is almost always the one — and
 * the duplicate's invoices and payments move there, with any phone or email
 * the kept one lacked. The duplicate is removed. Owners and managers only, on
 * the server; the page only offers it to them.
 */
export function MergeCustomerDialog({
  duplicate,
  onClose,
}: {
  duplicate: CustomerView;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [keepId, setKeepId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => api.get<CustomerView[]>('/customers'),
  });

  const others = customers.filter((customer) => customer.id !== duplicate.id);
  const term = search.trim().toLowerCase();
  const sameName = nameOf(duplicate).toLowerCase();
  // Same name first, then everyone else that matches what is typed.
  const choices = others
    .filter(
      (customer) =>
        !term ||
        `${nameOf(customer)} ${customer.phone ?? ''}`
          .toLowerCase()
          .includes(term),
    )
    .sort(
      (a, b) =>
        Number(nameOf(b).toLowerCase() === sameName) -
          Number(nameOf(a).toLowerCase() === sameName) ||
        nameOf(a).localeCompare(nameOf(b)),
    )
    .slice(0, 8);
  const keep = others.find((customer) => customer.id === keepId);

  const merge = useMutation({
    mutationFn: () =>
      api.post<CustomerMergeView>(`/customers/${duplicate.id}/merge`, {
        intoCustomerId: keepId,
      }),
    onSuccess: (result) => {
      afterWrite(queryClient);
      navigate(`/customers/${result.customer.id}`, { replace: true });
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError ? caught.message : 'Could not merge them.',
      ),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (keepId) merge.mutate();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="merge-title"
    >
      <form
        onSubmit={submit}
        className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-lg"
      >
        <DialogClose onClose={onClose} />
        <h2 id="merge-title" className="text-lg font-semibold text-slate-900">
          Same customer as someone else?
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Choose who stays. <strong>{nameOf(duplicate)}</strong>
          {duplicate.phone ? ` (${duplicate.phone})` : ''} is then removed, and
          their invoices and payments move across.
        </p>

        <div className="mt-4 space-y-3">
          <Field label="Find the customer to keep" htmlFor="merge-search">
            <Input
              id="merge-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name or phone"
              autoFocus
            />
          </Field>
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {choices.length === 0 && (
              <li className="p-3 text-sm text-slate-500">Nobody matches.</li>
            )}
            {choices.map((customer) => (
              <li key={customer.id}>
                <label className="flex cursor-pointer items-center gap-3 p-3 text-sm hover:bg-slate-50">
                  <input
                    type="radio"
                    name="keep"
                    checked={keepId === customer.id}
                    onChange={() => setKeepId(customer.id)}
                  />
                  <span>
                    <span className="text-slate-900">{nameOf(customer)}</span>
                    {customer.phone && (
                      <span className="ml-2 text-xs text-slate-500">
                        {customer.phone}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {keep && (
            <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              Everything of {nameOf(duplicate)} moves to{' '}
              <strong>{nameOf(keep)}</strong>, and {nameOf(duplicate)} is
              removed. This cannot be undone from the screen.
            </p>
          )}
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
            disabled={merge.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={!keepId || merge.isPending}>
            {merge.isPending ? 'Merging…' : 'Merge them'}
          </Button>
        </div>
      </form>
    </div>
  );
}
