import { useState, type FormEvent } from 'react';
import { useQueries } from '@tanstack/react-query';
import { api } from '../api/client';
import { optionLabel } from '../lib/options';
import { DialogClose } from '../components/DialogClose';
import { Button } from '../components/Button';
import { Field, Input, Select } from '../components/Field';
import { QuantityInput } from '../components/QuantityInput';
import { Money } from '../components/Money';
import type { components } from '../api/schema';

type SaleView = components['schemas']['SaleView'];
type ProductView = components['schemas']['ProductView'];

export interface ReturnLineInput {
  saleLineId: string;
  quantity: number;
  restocked: boolean;
  reason: string;
  /**
   * Only for goods sold before the product had options: which option they go
   * back on the shelf as. A line sold as an option goes back as that option.
   */
  variantId?: string;
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

  // Goods sold before their product had options carry none; if it has options
  // now, what goes back on the shelf has to be one of them (DECISIONS.md §24).
  // Only those products are read, and usually there are none.
  const optionless = [
    ...new Set(
      sale.lines.filter((line) => !line.variant).map((line) => line.productId),
    ),
  ];
  const products = useQueries({
    queries: optionless.map((productId) => ({
      queryKey: ['product', productId],
      queryFn: () => api.get<ProductView>(`/products/${productId}`),
      staleTime: 60_000,
    })),
  });
  const optionsFor = (line: SaleView['lines'][number]) =>
    line.variant
      ? []
      : (products
          .find((query) => query.data?.id === line.productId)
          ?.data?.variants.filter((option) => option.isActive) ?? []);

  const chosen = Object.values(lines);
  const unplaced = chosen.some((entry) => {
    const line = sale.lines.find((row) => row.id === entry.saleLineId);
    return (
      entry.restocked &&
      !entry.variantId &&
      line !== undefined &&
      optionsFor(line).length > 0
    );
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (chosen.length > 0 && !unplaced) onConfirm(chosen, note.trim());
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
        className="relative my-8 w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-lg"
      >
        <DialogClose onClose={onCancel} />

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
            const options = optionsFor(line);
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
                      {optionLabel(line.product.name, line.variant?.name)}
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
                        label={`How many ${optionLabel(line.product.name, line.variant?.name)} to return`}
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

                    {entry.restocked && options.length > 0 && (
                      <div className="sm:col-span-3">
                        <Field
                          label="Back on the shelf as"
                          htmlFor={`option-${line.id}`}
                          hint={`Sold before ${line.product.name} had options, so say which one this is.`}
                        >
                          <Select
                            id={`option-${line.id}`}
                            value={entry.variantId ?? ''}
                            disabled={busy}
                            onChange={(event) =>
                              update(line.id, {
                                variantId: event.target.value || undefined,
                              })
                            }
                          >
                            <option value="">Choose…</option>
                            {options.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.name}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      </div>
                    )}
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
          <Button
            type="submit"
            disabled={busy || chosen.length === 0 || unplaced}
          >
            {busy
              ? 'Recording…'
              : `Take back ${chosen.length} line${chosen.length === 1 ? '' : 's'}`}
          </Button>
        </div>
      </form>
    </div>
  );
}
