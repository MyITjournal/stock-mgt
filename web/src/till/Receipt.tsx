import { Money } from '../components/Money';
import { Button } from '../components/Button';
import type { components } from '../api/schema';

type Receipt = components['schemas']['SaleReceiptView'];

/**
 * What the sale actually was.
 *
 * **Every figure here is the server's.** The cart showed a preview — exact,
 * because prices are tax-inclusive and a line is integer multiplication — but
 * VAT, the invoice total and what is still owed are all computed once, on the
 * server, and read back (DECISIONS.md §17). If this ever disagrees with the
 * running total on the previous screen, that is a bug rather than rounding.
 *
 * VAT reads **"of which"** and is never added on top, because prices are stored
 * tax-inclusive: adding it would charge the customer twice for it (§2, §6).
 */
export function Receipt({
  receipt,
  onNewSale,
}: {
  receipt: Receipt;
  onNewSale: () => void;
}) {
  return (
    <div className="mx-auto max-w-md">
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex items-baseline justify-between border-b border-slate-200 pb-3">
          <div>
            <div className="text-lg font-semibold text-slate-900">
              {receipt.number}
            </div>
            <div className="text-xs text-slate-500">
              {new Date(receipt.occurredAt).toLocaleString('en-NG')}
            </div>
          </div>
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
            Recorded
          </span>
        </div>

        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-500">Customer</dt>
            <dd className="text-slate-900">{receipt.customer ?? 'Walk-in'}</dd>
          </div>
          {receipt.servedBy && (
            <div className="flex justify-between">
              <dt className="text-slate-500">Served by</dt>
              <dd className="text-slate-900">{receipt.servedBy}</dd>
            </div>
          )}
        </dl>

        <table className="mt-4 w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {receipt.lines.map((line, index) => (
              <tr key={index}>
                <td className="py-2">
                  <div className="text-slate-900">{line.description}</div>
                  <div className="text-xs text-slate-500">
                    {line.quantity} × {line.unit} @{' '}
                    <Money value={line.unitPrice} />
                  </div>
                </td>
                <td className="py-2 text-right align-top text-slate-900">
                  <Money value={line.lineTotal} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 space-y-1 border-t border-slate-200 pt-3 text-sm">
          <div className="flex justify-between font-semibold text-slate-900">
            <span>Total</span>
            <Money value={receipt.total} />
          </div>
          <div className="flex justify-between text-xs text-slate-500">
            <span>of which VAT</span>
            <Money value={receipt.tax} />
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Paid</span>
            <Money value={receipt.paid} />
          </div>
          {receipt.balance !== 0 && (
            <div className="flex justify-between font-medium text-amber-700">
              <span>Balance</span>
              <Money value={receipt.balance} signed />
            </div>
          )}
        </div>

        {receipt.note && (
          <p className="mt-3 text-xs text-slate-500">{receipt.note}</p>
        )}
      </div>

      <Button onClick={onNewSale} className="mt-4 h-12 w-full text-base" autoFocus>
        New sale
      </Button>
    </div>
  );
}
