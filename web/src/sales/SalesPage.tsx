import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Money } from '../components/Money';
import { Button } from '../components/Button';
import { Field, Input, Select } from '../components/Field';
import { api } from '../api/client';
import type { components } from '../api/schema';

type SaleListView = components['schemas']['SaleListView'];
type CustomerView = components['schemas']['CustomerView'];

const PAGE = 25;

/**
 * What we sold, newest first.
 *
 * Reads `GET /sales` with `order=desc`, which is the browsing half of an
 * endpoint that also feeds delta sync. The two want opposite orders and the
 * difference is not cosmetic: a sync walks *forward* from the oldest row it has
 * not seen, because its cursor only moves forward and a skipped row is skipped
 * forever. A person wants today at the top and pages backward into last week
 * (DECISIONS.md §17).
 *
 * Paging is by cursor rather than page number, so rows written while someone
 * reads cannot shift the list under them and show the same sale twice.
 */
export function SalesPage() {
  const [customerId, setCustomerId] = useState('');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [pages, setPages] = useState<string[]>([]);

  const cursor = pages.at(-1);

  const query = new URLSearchParams({ order: 'desc', limit: String(PAGE) });
  if (customerId) query.set('customerId', customerId);
  if (since) query.set('since', new Date(since).toISOString());
  // The whole of the end day, not midnight at the start of it — "up to the
  // 25th" means including the 25th to everyone except a computer.
  if (until) query.set('until', new Date(`${until}T23:59:59.999`).toISOString());
  if (cursor) query.set('cursor', cursor);

  const { data, isPending, error } = useQuery({
    queryKey: ['sales', query.toString()],
    queryFn: () => api.get<SaleListView>(`/sales?${query}`),
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => api.get<CustomerView[]>('/customers'),
  });

  /** Any filter change invalidates where we had paged to. */
  const refilter = (apply: () => void) => {
    apply();
    setPages([]);
  };

  return (
    <Page title="Sales" description="Newest first.">
      <div className="mb-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-4">
        <Field label="Customer" htmlFor="filter-customer">
          <Select
            id="filter-customer"
            value={customerId}
            onChange={(event) =>
              refilter(() => setCustomerId(event.target.value))
            }
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

        <Field label="From" htmlFor="filter-since">
          <Input
            id="filter-since"
            type="date"
            value={since}
            onChange={(event) => refilter(() => setSince(event.target.value))}
          />
        </Field>

        <Field label="To" htmlFor="filter-until">
          <Input
            id="filter-until"
            type="date"
            value={until}
            onChange={(event) => refilter(() => setUntil(event.target.value))}
          />
        </Field>

        <div className="flex items-end">
          <Button
            variant="secondary"
            onClick={() =>
              refilter(() => {
                setCustomerId('');
                setSince('');
                setUntil('');
              })
            }
          >
            Clear filters
          </Button>
        </div>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error.message}
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Invoice</th>
              <th className="px-4 py-2 font-medium">When</th>
              <th className="px-4 py-2 font-medium">Customer</th>
              <th className="px-4 py-2 text-right font-medium">Total</th>
              <th className="px-4 py-2 text-right font-medium">Owing</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isPending && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            )}

            {data?.sales.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  No sales match that.
                </td>
              </tr>
            )}

            {data?.sales.map((sale) => (
              <tr key={sale.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link
                    to={`/sales/${sale.id}`}
                    className="font-medium text-slate-900 underline-offset-2 hover:underline"
                  >
                    {sale.number}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {new Date(sale.occurredAt).toLocaleDateString('en-NG')}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {sale.customer
                    ? [sale.customer.firstName, sale.customer.lastName]
                        .filter(Boolean)
                        .join(' ')
                    : 'Walk-in'}
                </td>
                <td className="px-4 py-3 text-right">
                  <Money value={sale.total} />
                </td>
                <td className="px-4 py-3 text-right">
                  {sale.balance === 0 ? (
                    <span className="text-xs text-slate-400">settled</span>
                  ) : (
                    <Money value={sale.balance} signed />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
    </Page>
  );
}
