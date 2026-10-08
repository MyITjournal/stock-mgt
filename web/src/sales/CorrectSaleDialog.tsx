import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DialogClose } from '../components/DialogClose';
import { Button } from '../components/Button';
import { Field, Input, MoneyInput, Select } from '../components/Field';
import { Money } from '../components/Money';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import type { components } from '../api/schema';
import { optionLabel } from '../lib/options';

type SaleView = components['schemas']['SaleView'];
type CustomerView = components['schemas']['CustomerView'];
type PreviewView = components['schemas']['SaleCorrectionPreviewView'];

/**
 * Putting a recorded sale right (2026-10-08) — owner or manager.
 *
 * A rep rang it up at the list price and the owner gave a discount, so the
 * cash in hand is less than the app says: type **the price each item was
 * really sold at**. Or it was sold to the wrong customer, or as a walk-in to
 * somebody who has an account: pick the right one. Or both, with one reason.
 *
 * **Check before save, and the check is the server's**: it runs the real
 * correction and rolls it back, so the new total, VAT, what was paid and what
 * is still owed are the server's own figures — the browser works out no money
 * — and a refusal shows up here rather than on save. Changing anything clears
 * the check.
 *
 * Prices are closed once goods have come back on the sale: the refund was
 * worked out from the old price. The customer can still be changed.
 */
export function CorrectSaleDialog({
  sale,
  onClose,
}: {
  sale: SaleView;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  // The correction's own id, kept across a retry so two attempts are one.
  const [correctionId] = useState(() => crypto.randomUUID());
  const [customerId, setCustomerId] = useState<string | null>(sale.customerId);
  const [prices, setPrices] = useState<Record<string, number | null>>(() =>
    Object.fromEntries(sale.lines.map((line) => [line.id, line.unitPrice])),
  );
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<PreviewView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pricesClosed = sale.returns.length > 0;

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => api.get<CustomerView[]>('/customers'),
  });

  const missing = sale.lines.filter((line) => prices[line.id] === null);
  const changedLines = sale.lines.filter(
    (line) => prices[line.id] !== null && prices[line.id] !== line.unitPrice,
  );
  const customerChanged = customerId !== sale.customerId;
  const nothingChanged = changedLines.length === 0 && !customerChanged;

  const body = () => ({
    id: correctionId,
    reason: reason.trim(),
    ...(customerChanged && { customerId }),
    ...(changedLines.length > 0 && {
      lines: changedLines.map((line) => ({
        lineId: line.id,
        unitPrice: prices[line.id] as number,
      })),
    }),
  });

  const failed = (caught: unknown) =>
    setError(
      caught instanceof ApiError ? caught.message : 'Could not do that.',
    );

  const check = useMutation({
    mutationFn: () =>
      api.post<PreviewView>(`/sales/${sale.id}/corrections/preview`, body()),
    onSuccess: (result) => {
      setError(null);
      setPreview(result);
    },
    onError: failed,
  });

  const save = useMutation({
    mutationFn: () =>
      api.post<SaleView>(`/sales/${sale.id}/corrections`, body()),
    onSuccess: (updated) => {
      queryClient.setQueryData(['sale', sale.id], updated);
      afterWrite(queryClient);
      onClose();
    },
    onError: failed,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (nothingChanged || missing.length > 0 || reason.trim().length < 3) {
      return;
    }
    if (preview) save.mutate();
    else check.mutate();
  };

  const busy = check.isPending || save.isPending;
  const nameOf = (customer: CustomerView) =>
    [customer.firstName, customer.lastName].filter(Boolean).join(' ') +
    (customer.phone ? ` · ${customer.phone}` : '');
  const previewLine = (lineId: string) =>
    preview?.lines.find((row) => row.lineId === lineId);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="correct-sale-title"
    >
      <form
        onSubmit={submit}
        className="relative my-8 w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-lg"
      >
        <DialogClose onClose={onClose} />
        <h2
          id="correct-sale-title"
          className="text-lg font-semibold text-slate-900"
        >
          Correct {sale.number}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Enter what is true: the price each item was really sold at, and who
          bought it. Stock does not change. What the sale said before is kept.
        </p>

        <div className="mt-4 space-y-4">
          <Field
            label="Customer"
            htmlFor="correct-customer"
            hint="Payments made only for this sale move with it. Prices stay as charged."
          >
            <Select
              id="correct-customer"
              value={customerId ?? ''}
              onChange={(event) => {
                setCustomerId(event.target.value || null);
                setPreview(null);
              }}
            >
              <option value="">Walk-in</option>
              {/* The sale's own customer, even if the list has not loaded. */}
              {sale.customer &&
                !customers.some((row) => row.id === sale.customer?.id) && (
                  <option value={sale.customer.id}>
                    {[sale.customer.firstName, sale.customer.lastName]
                      .filter(Boolean)
                      .join(' ')}
                  </option>
                )}
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {nameOf(customer)}
                </option>
              ))}
            </Select>
          </Field>

          <div className="overflow-hidden rounded-md border border-slate-200">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Item</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  <th className="px-3 py-2 font-medium">Price each</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sale.lines.map((line) => {
                  const after = previewLine(line.id);
                  return (
                    <tr key={line.id}>
                      <td className="px-3 py-2">
                        <div className="text-slate-900">
                          {optionLabel(line.product.name, line.variant?.name)}
                        </div>
                        <div className="text-xs text-slate-500">
                          Sold at <Money value={line.unitPrice} /> a{' '}
                          {line.unit.name}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {line.quantity} {line.unit.name}
                      </td>
                      <td className="px-3 py-2">
                        <MoneyInput
                          id={`price-${line.id}`}
                          aria-label={`Price of one ${line.unit.name}`}
                          className="w-32"
                          disabled={pricesClosed}
                          value={prices[line.id]}
                          onChange={(value) => {
                            setPrices((current) => ({
                              ...current,
                              [line.id]: value,
                            }));
                            setPreview(null);
                          }}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        {after ? (
                          <>
                            <span className="text-slate-400 line-through">
                              <Money value={after.lineTotalBefore} />
                            </span>{' '}
                            <Money value={after.lineTotalAfter} />
                          </>
                        ) : (
                          <Money value={line.lineTotal} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pricesClosed && (
            <p className="text-sm text-amber-700">
              Goods have come back on this sale, and the refund was worked out
              from these prices, so they can no longer be changed. The customer
              can.
            </p>
          )}

          <Field label="Why" htmlFor="correct-sale-reason">
            <Input
              id="correct-sale-reason"
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setPreview(null);
              }}
              placeholder="Discount agreed with the customer"
              required
            />
          </Field>
        </div>

        {missing.length > 0 && (
          <p className="mt-3 text-sm text-red-700">
            Enter a price for every item — 0 if it was given free.
          </p>
        )}

        {preview && (
          <div className="mt-4 rounded-md bg-slate-50 p-3 text-sm">
            <div className="font-medium text-slate-900">If you save:</div>
            <ul className="mt-1 space-y-0.5 text-slate-700">
              {preview.totalAfter !== preview.totalBefore && (
                <li>
                  Total: <Money value={preview.totalBefore} /> →{' '}
                  <Money value={preview.totalAfter} />
                  {preview.taxTotalAfter !== 0 && (
                    <>
                      {' '}
                      (of which VAT <Money value={preview.taxTotalAfter} />)
                    </>
                  )}
                </li>
              )}
              {preview.paymentFollows && (
                <li>
                  Paid: <Money value={preview.paidBefore} /> →{' '}
                  <Money value={preview.paidAfter} /> — the payment taken at the
                  time is cancelled and the true amount recorded in its place,
                  by the same person on the same day.
                </li>
              )}
              {preview.customerChanged && (
                <li>
                  Customer: {preview.customerAfter ?? 'Walk-in'}
                  {preview.paymentsMoved > 0 &&
                    ` — ${preview.paymentsMoved} payment${preview.paymentsMoved === 1 ? '' : 's'} move${preview.paymentsMoved === 1 ? 's' : ''} with it`}
                </li>
              )}
              <li>
                Still owed: <Money value={preview.balanceAfter} signed />
              </li>
            </ul>
          </div>
        )}

        {error && (
          <p
            className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700"
            role="alert"
          >
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={
              busy ||
              nothingChanged ||
              missing.length > 0 ||
              reason.trim().length < 3
            }
          >
            {busy ? 'Working…' : preview ? 'Save correction' : 'Check'}
          </Button>
        </div>
      </form>
    </div>
  );
}
