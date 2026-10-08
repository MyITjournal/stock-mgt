import { DialogClose } from '../components/DialogClose';
import { Button } from '../components/Button';
import { Money } from '../components/Money';
import type { components } from '../api/schema';

export type PossibleDuplicate =
  components['schemas']['PossibleDuplicateConflict'];

/**
 * "Already recorded?" (2026-10-08).
 *
 * The owner recorded a customer's sale because a member of staff had not;
 * nothing would have stopped him entering it again. The server now answers a
 * sale that looks like one already recorded — the same customer and day, or a
 * walk-in within ten minutes, with the same items — with a 409 naming it.
 *
 * **A warning, not a rule**, so it is for everyone at the till, not only an
 * owner or a manager, and there is no reason box: a customer can genuinely
 * buy the same thing twice. Three ways out — open the sale to look, record
 * anyway, or clear the cart because it is the same sale.
 */
export function DuplicateDialog({
  conflict,
  busy,
  onRecordAnyway,
  onClearCart,
  onCancel,
}: {
  conflict: PossibleDuplicate;
  busy: boolean;
  onRecordAnyway: () => void;
  onClearCart: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="duplicate-title"
    >
      <div className="relative w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-lg">
        <DialogClose onClose={onCancel} />

        <h2
          id="duplicate-title"
          className="text-lg font-semibold text-slate-900"
        >
          Already recorded?
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          A sale like this one is already in the books. If it is the same sale,
          do not record it again.
        </p>

        <ul className="mt-4 divide-y divide-slate-100 rounded-md border border-slate-200">
          {conflict.duplicates.map((sale) => (
            <li
              key={sale.id}
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
            >
              <span>
                <span className="font-medium text-slate-900">
                  {sale.number}
                </span>{' '}
                · <Money value={sale.total} />
                <span className="block text-xs text-slate-500">
                  {sale.recordedBy ? `by ${sale.recordedBy}, ` : ''}
                  {new Date(sale.occurredAt).toLocaleString('en-NG', {
                    weekday: 'short',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
              </span>
              {/* A new tab, so the cart stays as it is behind it. */}
              <a
                href={`/sales/${sale.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-sm font-medium text-slate-900 underline-offset-2 hover:underline"
              >
                Open it
              </a>
            </li>
          ))}
        </ul>

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onClearCart}
            disabled={busy}
          >
            Same sale — clear the cart
          </Button>
          <Button type="button" onClick={onRecordAnyway} disabled={busy}>
            {busy ? 'Recording…' : 'Record anyway'}
          </Button>
        </div>
      </div>
    </div>
  );
}
