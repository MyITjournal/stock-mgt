import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Money } from '../components/Money';
import { Button } from '../components/Button';
import { PdfButton } from '../components/PdfButton';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import { useSeesCost } from '../auth/useAuth';
import type { components } from '../api/schema';
import { ReturnDialog, type ReturnLineInput } from './ReturnDialog';

type SaleView = components['schemas']['SaleView'];

/**
 * One invoice: what was sold, what was paid, what came back, what is left.
 *
 * Cost is shown only to a role that may see it — and note that the check here
 * is `useSeesCost`, not `sale.costTotal != null`. The server **removes** the
 * key rather than nulling it (DECISIONS.md §9), so the figure is genuinely
 * absent for a rep and `<Money>` renders an em dash. Hiding the whole column is
 * a courtesy so a rep is not shown a row that will always read as blank; the
 * server is what actually withholds it.
 */
export function SaleDetailPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const seesCost = useSeesCost();
  const [returning, setReturning] = useState(false);
  const [returnError, setReturnError] = useState<string | null>(null);

  const { data: sale, isPending } = useQuery({
    queryKey: ['sale', id],
    queryFn: () => api.get<SaleView>(`/sales/${id}`),
  });

  const takeBack = useMutation({
    mutationFn: (input: { lines: ReturnLineInput[]; note: string }) =>
      api.post<SaleView>(`/sales/${id}/returns`, {
        id: crypto.randomUUID(),
        ...(input.note && { note: input.note }),
        lines: input.lines.map((line) => ({
          id: crypto.randomUUID(),
          saleLineId: line.saleLineId,
          quantity: line.quantity,
          restocked: line.restocked,
          ...(line.reason && { reason: line.reason }),
        })),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['sale', id], updated);
      afterWrite(queryClient);
      setReturning(false);
      setReturnError(null);
    },
    onError: (error) =>
      setReturnError(
        error instanceof ApiError ? error.message : 'Could not record that.',
      ),
  });

  if (isPending) {
    return (
      <Page title="Sale">
        <p className="text-sm text-slate-500">Loading…</p>
      </Page>
    );
  }

  if (!sale) {
    return (
      <Page title="Sale">
        <p className="text-sm text-slate-500">That sale does not exist.</p>
      </Page>
    );
  }

  const customerName = sale.customer
    ? [sale.customer.firstName, sale.customer.lastName]
        .filter(Boolean)
        .join(' ')
    : 'Walk-in';

  return (
    <Page
      title={sale.number}
      description={`${new Date(sale.occurredAt).toLocaleString('en-NG')} · ${customerName}`}
      actions={
        <>
          <PdfButton path={`/sales/${sale.id}/invoice.pdf`} label="Invoice PDF" />
          <Button onClick={() => setReturning(true)}>Take goods back</Button>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Item</th>
                  <th className="px-4 py-2 font-medium">Unit</th>
                  <th className="px-4 py-2 text-right font-medium">Qty</th>
                  <th className="px-4 py-2 text-right font-medium">Price</th>
                  {seesCost && (
                    <th className="px-4 py-2 text-right font-medium">Cost</th>
                  )}
                  <th className="px-4 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sale.lines.map((line) => (
                  <tr key={line.id}>
                    <td className="px-4 py-3">
                      <div className="text-slate-900">{line.product.name}</div>
                      <div className="text-xs text-slate-500">
                        {line.product.sku}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {line.unit.name}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {line.quantity}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Money value={line.unitPrice} />
                    </td>
                    {seesCost && (
                      <td className="px-4 py-3 text-right">
                        <Money value={line.costOfGoodsSold} />
                        {line.costIsEstimated && (
                          <span
                            className="ml-1 text-xs text-amber-700"
                            title="Sold before the delivery it came from was recorded, so this is the rate from the last real lot rather than an invoice."
                          >
                            est.
                          </span>
                        )}
                      </td>
                    )}
                    <td className="px-4 py-3 text-right font-medium">
                      <Money value={line.lineTotal} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {sale.returns.length > 0 && (
            <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <h2 className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs uppercase tracking-wide text-slate-500">
                Goods taken back
              </h2>
              <ul className="divide-y divide-slate-100 text-sm">
                {sale.returns.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between px-4 py-3"
                  >
                    <span>
                      <span className="text-slate-900">
                        {entry.quantity} back
                      </span>
                      <span className="ml-2 text-xs text-slate-500">
                        {new Date(entry.occurredAt).toLocaleDateString('en-NG')}
                        {entry.reason ? ` · ${entry.reason}` : ''}
                      </span>
                      {!entry.restocked && (
                        <span className="ml-2 text-xs text-amber-700">
                          damaged, not restocked
                        </span>
                      )}
                    </span>
                    <Money value={entry.refundAmount} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {sale.allocations.length > 0 && (
            <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <h2 className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs uppercase tracking-wide text-slate-500">
                Payments
              </h2>
              <ul className="divide-y divide-slate-100 text-sm">
                {sale.allocations.map((allocation) => (
                  <li
                    key={allocation.id}
                    className="flex items-center justify-between px-4 py-3"
                  >
                    <span>
                      <span className="text-slate-900">
                        {allocation.payment.method}
                      </span>
                      <span className="ml-2 text-xs text-slate-500">
                        {new Date(
                          allocation.payment.occurredAt,
                        ).toLocaleDateString('en-NG')}
                        {allocation.payment.reference
                          ? ` · ${allocation.payment.reference}`
                          : ''}
                      </span>
                    </span>
                    <Money value={allocation.amount} signed />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
            <dl className="space-y-2">
              <Row label="Total" value={<Money value={sale.total} />} strong />
              <Row
                label="of which VAT"
                value={<Money value={sale.taxTotal} />}
                muted
              />
              {seesCost && (
                <Row label="Cost" value={<Money value={sale.costTotal} />} />
              )}
              <Row label="Paid" value={<Money value={sale.allocated} />} />
              {sale.refunded !== 0 && (
                <Row label="Refunded" value={<Money value={sale.refunded} />} />
              )}
              <Row
                label="Balance"
                value={<Money value={sale.balance} signed />}
                strong
              />
            </dl>
          </div>

          {sale.creditOverrideReason && (
            <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
              <div className="font-medium">Sold on credit by override</div>
              <p className="mt-1 text-xs">{sale.creditOverrideReason}</p>
            </div>
          )}

          <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
            <dl className="space-y-2">
              <Row label="Location" value={sale.location.name} />
              {sale.tier && <Row label="Price list" value={sale.tier.name} />}
              {sale.recordedBy && (
                <Row
                  label="Served by"
                  value={[sale.recordedBy.firstName, sale.recordedBy.lastName]
                    .filter(Boolean)
                    .join(' ')}
                />
              )}
              {sale.customer && (
                <Row
                  label="Customer"
                  value={
                    <Link
                      to={`/customers/${sale.customer.id}`}
                      className="underline underline-offset-2"
                    >
                      {customerName}
                    </Link>
                  }
                />
              )}
            </dl>
          </div>

          {sale.note && (
            <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
              {sale.note}
            </p>
          )}
        </aside>
      </div>

      {returning && (
        <ReturnDialog
          sale={sale}
          busy={takeBack.isPending}
          error={returnError}
          onCancel={() => {
            setReturning(false);
            setReturnError(null);
          }}
          onConfirm={(lines, note) => takeBack.mutate({ lines, note })}
        />
      )}
    </Page>
  );
}

function Row({
  label,
  value,
  strong,
  muted,
}: {
  label: string;
  value: React.ReactNode;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4">
      <dt className={muted ? 'text-xs text-slate-400' : 'text-slate-500'}>
        {label}
      </dt>
      <dd
        className={
          strong
            ? 'font-semibold text-slate-900'
            : muted
              ? 'text-xs text-slate-400'
              : 'text-slate-900'
        }
      >
        {value}
      </dd>
    </div>
  );
}
