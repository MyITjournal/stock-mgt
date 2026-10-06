import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Money } from './Money';
import { api } from '../api/client';
import type { components } from '../api/schema';
import { dueStatus } from '../lib/due';

type DueInvoicesView = components['schemas']['DueInvoicesView'];

/**
 * Payments due — who to ask for money, and how late they are.
 *
 * Credit sales are due five days after the sale; this lists those overdue,
 * due today, or due in the next two days, oldest first (`GET /sales/due`).
 * **Shown to every member of staff**, on the till as well as on Home, because
 * the person at the counter is the one who sees the customer come in. The
 * days are the server's, counted in the shop's timezone. The phone number is
 * a link, so on a phone one tap rings them.
 *
 * Nothing at all is shown when nothing is due — on the till especially, an
 * empty box is clutter. `collapsible` starts it folded to one line there.
 */
export function DuePayments({
  collapsible = false,
}: {
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(!collapsible);
  const { data } = useQuery({
    queryKey: ['sales-due'],
    queryFn: () => api.get<DueInvoicesView>('/sales/due'),
  });

  if (!data || data.invoices.length === 0) return null;

  const summary = `${data.invoices.length} payment${data.invoices.length === 1 ? '' : 's'} due${
    data.overdue > 0 ? ` · ${data.overdue} overdue` : ''
  }`;

  return (
    <section
      className={`mb-6 rounded-lg border p-4 ${
        data.overdue > 0
          ? 'border-red-200 bg-red-50/50'
          : 'border-amber-200 bg-amber-50/50'
      }`}
    >
      <button
        type="button"
        onClick={() => collapsible && setOpen(!open)}
        className={`flex w-full items-center justify-between text-left ${collapsible ? '' : 'cursor-default'}`}
        aria-expanded={open}
      >
        <span className="text-sm font-semibold text-slate-900">
          Payments due
          <span className="ml-2 font-normal text-slate-600">{summary}</span>
        </span>
        {collapsible && (
          <span className="text-xs text-slate-500">
            {open ? 'Hide' : 'Show'}
          </span>
        )}
      </button>

      {open && (
        <ul className="mt-3 divide-y divide-slate-200/70 text-sm">
          {data.invoices.map((invoice) => {
            const status = dueStatus(invoice.daysPastDue);
            return (
              <li
                key={invoice.saleId}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <span>
                  <span className="font-medium text-slate-900">
                    {invoice.customer.name}
                  </span>
                  {invoice.customer.phone && (
                    <a
                      href={`tel:${invoice.customer.phone}`}
                      className="ml-2 text-xs text-slate-600 underline underline-offset-2"
                    >
                      {invoice.customer.phone}
                    </a>
                  )}
                  <Link
                    to={`/sales/${invoice.saleId}`}
                    className="ml-2 text-xs text-slate-500 underline-offset-2 hover:underline"
                  >
                    {invoice.number}
                  </Link>
                </span>
                <span className="flex items-center gap-3">
                  <span className={`text-xs ${status.tone}`}>
                    {status.text}
                  </span>
                  <span className="font-medium text-slate-900">
                    <Money value={invoice.balance} />
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
