import { useState, type FormEvent } from 'react';
import { Button } from '../components/Button';
import { Field, Input } from '../components/Field';
import { QuantityInput } from '../components/QuantityInput';
import { Money } from '../components/Money';
import type { components } from '../api/schema';

type SaleView = components['schemas']['SaleView'];

export interface ReturnLineInput {
  saleLineId: string;
  quantity: number;
  restocked: boolean;
  reason: string;
}

/**
 * Taking goods back.
 *
 * **Restocked or not is the decision this dialog exists to force.** A return
 * refunds a share of what was actually charged either way — but goods that came
 * back broken must never re-enter sellable stock, so `restocked: false` writes
 * no movement at all (DECISIONS.md §4). Defaulting it silently would either
 * quietly resell a crushed carton or quietly lose good stock; both are wrong
 * and neither is visible afterwards.
 *
 * Quantity is counted in the unit the line was sold in, so "two cartons back"
 * needs no arithmetic from whoever is standing at the counter.
 */
export function ReturnDialog({
  sale,
  onConfirm,
  onCancel,
  busy,
  error,
}: {
  sale: SaleView;
  onConfirm: (lines: ReturnLineInput[], note: string) => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
}) {
  const [lines, setLines] = useState<Record<string, ReturnLineInput>>({});
  const [note, setNote] = useState('');

  const toggle = (saleLineId: string, on: boolean) =>
    setLines((current) => {
      if (!on) {
        const { [saleLineId]: _removed, ...rest } = current;
        return rest;
      }
      return {
        ...current,
        [saleLineId]: {
          saleLineId,
          quantity: 1,
          restocked: true,
          reason: '',
        },
      };
    });

  const update = (saleLineId: string, change: Partial<ReturnLineInput>) =>
    setLines((current) => ({
      ...current,
      [saleLineId]: { ...current[saleLineId], ...change },
    }));

  const chosen = Object.values(lines);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (chosen.length > 0) onConfirm(chosen, note.trim());
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="return-title"
    >
      <form
        onSubmit={submit}
        className="my-8 w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-lg"
      >
        <h2 id="return-title" className="text-lg font-semibold text-slate-900">
          Take goods back from {sale.number}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Pick what is coming back. The refund is a share of what was actually
          charged, not today's price.
        </p>

        <div className="mt-4 space-y-3">
          {sale.lines.map((line) => {
            const entry = lines[line.id];
            return (
              <div
                key={line.id}
                className="rounded-lg border border-slate-200 p-3"
              >
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={Boolean(entry)}
                    onChange={(event) => toggle(line.id, event.target.checked)}
                    disabled={busy}
                    className="mt-1"
                  />
                  <span className="flex-1">
                    <span className="font-medium text-slate-900">
                      {line.product.name}
                    </span>
                    <span className="ml-2 text-xs text-slate-500">
                      {line.quantity} × {line.unit.name} @{' '}
                      <Money value={line.unitPrice} />
                    </span>
                  </span>
                  <Money value={line.lineTotal} />
                </label>

                {entry && (
                  <div className="mt-3 grid gap-3 pl-7 sm:grid-cols-3">
                    <Field label="How many" htmlFor={`qty-${line.id}`}>
                      <QuantityInput
                        id={`qty-${line.id}`}
                        label={`How many ${line.product.name} to return`}
                        min={1}
                        max={line.quantity}
                        value={entry.quantity}
                        disabled={busy}
                        onChange={(next) => update(line.id, { quantity: next })}
                      />
                    </Field>

                    <Field label="Reason" htmlFor={`reason-${line.id}`}>
                      <Input
                        id={`reason-${line.id}`}
                        value={entry.reason}
                        disabled={busy}
                        placeholder="Wrong flavour."
                        onChange={(event) =>
                          update(line.id, { reason: event.target.value })
                        }
                      />
                    </Field>

                    <div className="flex items-end pb-1">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={entry.restocked}
                          disabled={busy}
                          onChange={(event) =>
                            update(line.id, { restocked: event.target.checked })
                          }
                        />
                        <span
                          className={
                            entry.restocked ? 'text-slate-700' : 'text-amber-700'
                          }
                        >
                          {entry.restocked
                            ? 'Back into stock'
                            : 'Damaged — not resellable'}
                        </span>
                      </label>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-4">
          <Field label="Note" htmlFor="return-note">
            <Input
              id="return-note"
              value={note}
              disabled={busy}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Customer brought them back on Friday."
            />
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
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={busy || chosen.length === 0}>
            {busy
              ? 'Recording…'
              : `Take back ${chosen.length} line${chosen.length === 1 ? '' : 's'}`}
          </Button>
        </div>
      </form>
    </div>
  );
}
