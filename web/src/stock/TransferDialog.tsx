import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../components/Button';
import { Field, Input, Select } from '../components/Field';
import { api, ApiError } from '../api/client';
import { useIsManager } from '../auth/useAuth';
import { OverrideDialog } from '../till/OverrideDialog';
import { useProductUnits, toBaseUnits } from './units';
import type { components } from '../api/schema';

type LocationView = components['schemas']['LocationView'];

/**
 * Moving stock between locations.
 *
 * The business owns exactly as much afterwards as before, so this is written
 * as a **matched pair of movements sharing a `transferGroupId`** rather than
 * one row with two location columns: a balance stays a plain sum over one
 * column, and the two halves still read as one act (DECISIONS.md §3).
 *
 * **Batch identity is preserved** — the carton that arrives in the van is the
 * same lot, with the same expiry, that left the store — so the receiving end
 * needs no lot details. That is why this form has fewer questions than an
 * adjustment despite doing more.
 *
 * Moving more than is on hand is refused with a 409 and overridable by an owner
 * or manager, the same rule as a sale.
 */
export function TransferDialog({
  product,
  from,
  onHand,
  locations,
  onClose,
}: {
  product: { id: string; name: string; sku: string };
  from: { id: string; name: string };
  onHand: number;
  locations: readonly LocationView[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const isManager = useIsManager();
  const { units, baseUnit } = useProductUnits(product.id);

  const elsewhere = locations.filter((location) => location.id !== from.id);

  const [toLocationId, setToLocationId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unitId, setUnitId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  // One transfer, however many attempts it takes. The id is also what the
  // server uses as the transferGroupId, so retrying cannot split the pair.
  const transferId = useMemo(() => crypto.randomUUID(), []);

  const unit = units.find((candidate) => candidate.id === unitId) ?? baseUnit;
  const typed = Number(quantity);
  const valid =
    Number.isInteger(typed) && typed > 0 && Boolean(toLocationId);
  const inBaseUnits = valid && unit ? toBaseUnits(typed, unit.factor) : 0;

  const move = useMutation({
    mutationFn: (forcedReason?: string) =>
      api.post<unknown>('/stock/transfers', {
        id: transferId,
        productId: product.id,
        fromLocationId: from.id,
        toLocationId,
        ...(unit && unit.factor !== 1 ? { unitId: unit.id } : {}),
        quantity: typed,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(forcedReason ? { force: true, forcedReason } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['stock-levels'] });
      void queryClient.invalidateQueries({ queryKey: ['stock-movements'] });
      onClose();
    },
    onError: (caught) => {
      if (caught instanceof ApiError && caught.isConflict && isManager) {
        setRefusal(caught.message);
        return;
      }
      // Falling out of the override and back to the form, so the message is
      // somewhere a person can see it: the override dialog only shows the 409.
      setRefusal(null);
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not move that stock.',
      );
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (valid) move.mutate(undefined);
  };

  if (refusal) {
    return (
      <OverrideDialog
        kind="stock"
        serverMessage={refusal}
        busy={move.isPending}
        onCancel={() => {
          setRefusal(null);
          onClose();
        }}
        onConfirm={(forcedReason) => move.mutate(forcedReason)}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="transfer-title"
    >
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-lg"
      >
        <h2 id="transfer-title" className="text-lg font-semibold text-slate-900">
          Move stock
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {product.name} · {onHand} at {from.name}
        </p>

        {elsewhere.length === 0 ? (
          <p className="mt-4 rounded-md bg-slate-50 p-3 text-sm text-slate-600">
            There is nowhere to move it to. Add another location under Places
            and vendors first.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            <Field label="Move to" htmlFor="transfer-to">
              <Select
                id="transfer-to"
                value={toLocationId}
                onChange={(event) => setToLocationId(event.target.value)}
                required
              >
                <option value="">Choose a location</option>
                {elsewhere.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Quantity"
                htmlFor="transfer-quantity"
                hint="Whole numbers only."
              >
                <Input
                  id="transfer-quantity"
                  inputMode="numeric"
                  value={quantity}
                  onChange={(event) =>
                    setQuantity(event.target.value.replace(/[^\d]/g, ''))
                  }
                  placeholder="0"
                  autoFocus
                  required
                />
              </Field>

              <Field label="Counted in" htmlFor="transfer-unit">
                <Select
                  id="transfer-unit"
                  value={unit?.id ?? ''}
                  onChange={(event) => setUnitId(event.target.value)}
                >
                  {units.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                      {option.factor === 1 ? '' : ` (${option.factor})`}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            {valid && unit && unit.factor !== 1 && (
              <p className="text-xs text-slate-500">
                That is {inBaseUnits}{' '}
                {baseUnit?.name.toLowerCase() ?? 'base unit'}
                {inBaseUnits === 1 ? '' : 's'}.
              </p>
            )}

            <Field label="Note" htmlFor="transfer-note">
              <Input
                id="transfer-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Loading the Tuesday round."
              />
            </Field>

            <p className="text-xs text-slate-500">
              The lot and its expiry travel with the goods, so nothing needs
              re-entering at the other end.
            </p>
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
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={move.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={move.isPending || !valid}>
            {move.isPending ? 'Moving…' : 'Move stock'}
          </Button>
        </div>
      </form>
    </div>
  );
}
