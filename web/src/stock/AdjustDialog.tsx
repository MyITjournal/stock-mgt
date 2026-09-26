import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../components/Button';
import { Field, Input, MoneyInput, Select } from '../components/Field';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import { useIsManager, useSeesCost } from '../auth/useAuth';
import { OverrideDialog } from '../till/OverrideDialog';
import { useProductUnits, toBaseUnits } from './units';

/** The reasons stock moves without being sold or delivered. */
const REASONS = [
  { value: 'damage', label: 'Damaged', direction: 'out' },
  { value: 'expiry', label: 'Expired', direction: 'out' },
  { value: 'theft', label: 'Missing or stolen', direction: 'out' },
  { value: 'opening_balance', label: 'Opening balance', direction: 'in' },
  { value: 'count_correction', label: 'Correction after counting', direction: 'either' },
  { value: 'other', label: 'Something else', direction: 'either' },
] as const;

type Reason = (typeof REASONS)[number]['value'];

/**
 * Writing stock off, or bringing it on, with a reason.
 *
 * **Breakage and spoilage are movements with a reason, never silent
 * decrements** (DECISIONS.md §3). The quantity is signed: out takes stock away,
 * in brings it on.
 *
 * Two things this form has to get right:
 *
 * - **A surplus has to land in a lot**, because every movement carries a batch.
 *   Unless one is named, the server opens a new one — which is how stock that
 *   was never received through a delivery gets into the ledger with a cost
 *   attached. So the form asks for the lot details rather than inventing them.
 * - **An override keeps the id and changes the key.** The `Idempotency-Key` is
 *   bound to a hash of the body, so a retry that adds a reason is a *different*
 *   request and must not reuse the key. The stable thing across the two
 *   attempts is the movement `id`, minted once here (§8).
 *
 * Counting a whole location is a stocktake, not this. That is deliberate: a
 * count is recorded by whoever counts and posted by a manager, and doing it
 * through adjustments would collapse the two jobs into one (§5).
 */
export function AdjustDialog({
  product,
  location,
  onHand,
  onClose,
}: {
  product: { id: string; name: string; sku: string };
  location: { id: string; name: string };
  onHand: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const isManager = useIsManager();
  const seesCost = useSeesCost();
  const { units, baseUnit } = useProductUnits(product.id);

  const [direction, setDirection] = useState<'out' | 'in'>('out');
  const [reason, setReason] = useState<Reason>('damage');
  const [quantity, setQuantity] = useState('');
  const [unitId, setUnitId] = useState('');
  const [note, setNote] = useState('');
  const [lotCode, setLotCode] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [totalCost, setTotalCost] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  // Minted once and kept across an override retry: two attempts describe one
  // movement, and the server dedupes on the id rather than on the key.
  const movementId = useMemo(() => crypto.randomUUID(), []);

  const unit = units.find((candidate) => candidate.id === unitId) ?? baseUnit;
  const typed = Number(quantity);
  const valid = Number.isInteger(typed) && typed > 0;
  const inBaseUnits = valid && unit ? toBaseUnits(typed, unit.factor) : 0;

  const record = useMutation({
    mutationFn: (forcedReason?: string) =>
      api.post<unknown>('/stock/adjustments', {
        id: movementId,
        productId: product.id,
        locationId: location.id,
        ...(unit && unit.factor !== 1 ? { unitId: unit.id } : {}),
        quantity: direction === 'out' ? -typed : typed,
        reason,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(direction === 'in' && lotCode.trim()
          ? { lotCode: lotCode.trim() }
          : {}),
        ...(direction === 'in' && expiryDate
          ? { expiryDate: new Date(expiryDate).toISOString() }
          : {}),
        ...(direction === 'in' && totalCost !== null ? { totalCost } : {}),
        ...(forcedReason ? { force: true, forcedReason } : {}),
      }),
    onSuccess: () => {
      afterWrite(queryClient);
      onClose();
    },
    onError: (caught) => {
      // A 409 here is a rule, not a failure: the ledger cannot cover what is
      // going out. An owner or manager may force it with a reason; anybody
      // else sees the refusal, which is the truthful outcome.
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
          : 'Could not record that adjustment.',
      );
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (valid) record.mutate(undefined);
  };

  if (refusal) {
    return (
      <OverrideDialog
        kind="stock"
        serverMessage={refusal}
        busy={record.isPending}
        onCancel={() => {
          setRefusal(null);
          onClose();
        }}
        onConfirm={(forcedReason) => record.mutate(forcedReason)}
      />
    );
  }

  const allowed = REASONS.filter(
    (option) => option.direction === 'either' || option.direction === direction,
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="adjust-title"
    >
      <form
        onSubmit={submit}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-lg"
      >
        <h2 id="adjust-title" className="text-lg font-semibold text-slate-900">
          Adjust stock
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {product.name} · {location.name} · {onHand} on hand
        </p>

        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {(['out', 'in'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setDirection(option);
                  setReason(option === 'out' ? 'damage' : 'opening_balance');
                }}
                className={`rounded-md border px-3 py-2 text-sm transition ${
                  direction === option
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {option === 'out' ? 'Take stock off' : 'Bring stock on'}
              </button>
            ))}
          </div>

          <Field label="Reason" htmlFor="adjust-reason">
            <Select
              id="adjust-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value as Reason)}
            >
              {allowed.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Quantity"
              htmlFor="adjust-quantity"
              hint="Whole numbers only."
            >
              <Input
                id="adjust-quantity"
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

            <Field label="Counted in" htmlFor="adjust-unit">
              <Select
                id="adjust-unit"
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
              That is {inBaseUnits} {baseUnit?.name.toLowerCase() ?? 'base unit'}
              {inBaseUnits === 1 ? '' : 's'}, which is what the ledger records.
            </p>
          )}

          {direction === 'in' && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs text-slate-600">
                Stock coming on has to belong to a lot — every movement does.
                Leave these blank and a new one is opened for it.
              </p>

              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Lot code" htmlFor="adjust-lot">
                    <Input
                      id="adjust-lot"
                      value={lotCode}
                      onChange={(event) => setLotCode(event.target.value)}
                      placeholder="Optional"
                    />
                  </Field>

                  <Field label="Expires" htmlFor="adjust-expiry">
                    <Input
                      id="adjust-expiry"
                      type="date"
                      value={expiryDate}
                      onChange={(event) => setExpiryDate(event.target.value)}
                    />
                  </Field>
                </div>

                {seesCost && (
                  <Field
                    label="What this stock is worth, in total"
                    htmlFor="adjust-cost"
                    hint="Left blank it is worth nothing, and margins computed from it will read high."
                  >
                    <MoneyInput
                      id="adjust-cost"
                      value={totalCost}
                      onChange={setTotalCost}
                      placeholder="0.00"
                    />
                  </Field>
                )}
              </div>
            </div>
          )}

          <Field label="Note" htmlFor="adjust-note">
            <Input
              id="adjust-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Crate dropped at the back door."
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
            onClick={onClose}
            disabled={record.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={record.isPending || !valid}>
            {record.isPending ? 'Recording…' : 'Record adjustment'}
          </Button>
        </div>
      </form>
    </div>
  );
}
