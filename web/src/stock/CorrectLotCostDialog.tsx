import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DialogClose } from '../components/DialogClose';
import { Button } from '../components/Button';
import { Field, Input, MoneyInput, Select } from '../components/Field';
import { Money } from '../components/Money';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import type { components } from '../api/schema';
import { useProductUnits } from './units';

type LotCostCorrectionView = components['schemas']['LotCostCorrectionView'];

/**
 * Putting an opening-stock lot's cost right (2026-10-07).
 *
 * The owner entered three pieces of opening stock at a pack's cost, and every
 * average built on it read a fifth too high. **Only the value changes**: the
 * lot keeps its quantity and its movements, and sales already made keep the
 * cost they recorded. The cost is typed for one of whichever unit is chosen —
 * per piece or per 1/2 pack — and the server works out the lot's new total and
 * shows it before anything is saved, so the browser computes no money (§17).
 *
 * A delivery's lot is never offered this: deliveries are corrected through
 * their receipt, which also moves the bill.
 */
export function CorrectLotCostDialog({
  batchId,
  product,
  quantity,
  onClose,
}: {
  batchId: string;
  product: { id: string; name: string };
  /** Base units of the lot on hand here, for the heading. */
  quantity: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { units, baseUnit } = useProductUnits(product.id);
  const [unitId, setUnitId] = useState('');
  const [unitCost, setUnitCost] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const chosenUnitId = unitId || baseUnit?.id || '';
  const unitName =
    units.find((unit) => unit.id === chosenUnitId)?.name ?? 'unit';

  // The server's answer for what the lot would be worth — asked whenever the
  // unit or the cost changes, and only once both are there.
  const { data: preview, error: previewError } = useQuery({
    queryKey: ['lot-cost-preview', batchId, chosenUnitId, unitCost],
    queryFn: () =>
      api.post<LotCostCorrectionView>(
        `/stock/opening/lots/${batchId}/cost/preview`,
        { unitId: chosenUnitId, unitCost },
      ),
    enabled: Boolean(chosenUnitId) && unitCost !== null,
    retry: false,
  });

  const save = useMutation({
    mutationFn: () =>
      api.post<LotCostCorrectionView>(`/stock/opening/lots/${batchId}/cost`, {
        unitId: chosenUnitId,
        unitCost,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      afterWrite(queryClient);
      onClose();
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not correct that cost.',
      ),
  });

  const ready =
    Boolean(chosenUnitId) && unitCost !== null && reason.trim().length >= 3;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (ready) save.mutate();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lot-cost-title"
    >
      <form
        onSubmit={submit}
        className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-lg"
      >
        <DialogClose onClose={onClose} />
        <h2
          id="lot-cost-title"
          className="text-lg font-semibold text-slate-900"
        >
          Correct the opening cost
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          {product.name} — opening stock, {quantity} {baseUnit?.name ?? 'units'}{' '}
          here.
        </p>
        <p className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          Only what this stock is worth changes. How many there are stays the
          same, and sales already made keep the cost they were recorded with.
        </p>

        <div className="mt-4 space-y-4">
          <div className="flex gap-3">
            <Field label="Cost of one" htmlFor="lot-cost-unit">
              <Select
                id="lot-cost-unit"
                value={chosenUnitId}
                onChange={(event) => {
                  setUnitId(event.target.value);
                  // A cost typed for one unit is not the cost of another.
                  setUnitCost(null);
                }}
                className="w-40"
              >
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.factor === 1
                      ? unit.name
                      : `${unit.name} (${unit.factor})`}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Cost" htmlFor="lot-cost-amount">
              <div className="flex items-center gap-2">
                <MoneyInput
                  id="lot-cost-amount"
                  value={unitCost}
                  onChange={setUnitCost}
                  className="w-32"
                  autoFocus
                />
                <span className="whitespace-nowrap text-xs text-slate-500">
                  per {unitName}
                </span>
              </div>
            </Field>
          </div>

          {preview && (
            <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
              This lot ({preview.quantity} {preview.baseUnitName}) was worth{' '}
              <Money value={preview.totalCostBefore} />; it will be worth{' '}
              <strong>
                <Money value={preview.totalCostAfter} />
              </strong>
              .
            </div>
          )}
          {previewError && (
            <p className="text-sm text-red-700">
              {previewError instanceof ApiError
                ? previewError.message
                : 'Could not work that out.'}
            </p>
          )}

          <Field label="Why" htmlFor="lot-cost-reason">
            <Input
              id="lot-cost-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Entered at a pack's cost; it was half a pack."
              maxLength={500}
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
            disabled={save.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending || !ready}>
            {save.isPending ? 'Saving…' : 'Correct the cost'}
          </Button>
        </div>
      </form>
    </div>
  );
}
