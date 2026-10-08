import { Field, Input, MoneyInput, Select } from '../components/Field';
import { decimalDraft } from '../lib/decimalQuantity';
import type { OpeningDraft } from './openingDraft';

/**
 * "Already on your shelves?" — the optional last step of adding a product
 * (2026-10-08), so a product added after day one does not need a second visit
 * to *Opening stock* to say how many there are.
 *
 * It records exactly what that screen records: an **opening balance** at cost,
 * never a delivery — no bill, nothing owed, nothing counted toward a vendor's
 * target. The quantity may be a decimal of its unit ("6.25" cartons) as long
 * as it comes to whole counted-in units; the cost is for **one** of that unit,
 * and says so beside the box, because a carton's cost typed against a piece
 * values the lot twelve times over.
 */
export function OpeningStockFields({
  units,
  value,
  onChange,
  locations,
  problem,
}: {
  units: readonly { key: string; name: string }[];
  value: OpeningDraft;
  onChange: (next: OpeningDraft) => void;
  locations: readonly { id: string; name: string }[];
  problem: string | null;
}) {
  const named = units.filter((unit) => unit.name.trim());
  const unitName =
    named.find((unit) => unit.key === value.unitKey)?.name.trim() ?? 'unit';
  const set = (patch: Partial<OpeningDraft>) =>
    onChange({ ...value, ...patch });

  return (
    <section className="mt-6">
      <h3 className="text-sm font-semibold text-slate-900">
        Already on your shelves?{' '}
        <span className="font-normal text-slate-500">(optional)</span>
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        Recorded as opening stock at what it cost you — no bill, nothing owed.
        Leave it empty if the stock will come in as a delivery.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="How many" htmlFor="opening-quantity">
          <div className="flex gap-2">
            <Input
              id="opening-quantity"
              inputMode="decimal"
              className="w-28"
              placeholder="0"
              value={value.quantity}
              onChange={(event) =>
                set({ quantity: decimalDraft(event.target.value) })
              }
            />
            <Select
              aria-label="Counted in"
              className="flex-1"
              value={value.unitKey}
              onChange={(event) => {
                // A carton's cost kept against a piece would value the lot
                // twelve times over, silently — so the cost goes with the unit.
                set({ unitKey: event.target.value, unitCost: null });
              }}
            >
              {named.map((unit) => (
                <option key={unit.key} value={unit.key}>
                  {unit.name.trim()}
                </option>
              ))}
            </Select>
          </div>
        </Field>

        <Field label={`Cost of one ${unitName}`} htmlFor="opening-cost">
          <div className="flex items-center gap-2">
            <MoneyInput
              id="opening-cost"
              className="w-36"
              placeholder="0.00"
              value={value.unitCost}
              onChange={(unitCost) => set({ unitCost })}
            />
            <span className="whitespace-nowrap text-xs text-slate-500">
              per {unitName}
            </span>
          </div>
        </Field>

        <Field label="Expires (optional)" htmlFor="opening-expiry">
          <Input
            id="opening-expiry"
            type="date"
            value={value.expiryDate}
            onChange={(event) => set({ expiryDate: event.target.value })}
          />
        </Field>

        {locations.length > 1 && (
          <Field label="Where" htmlFor="opening-location">
            <Select
              id="opening-location"
              value={value.locationId}
              onChange={(event) => set({ locationId: event.target.value })}
            >
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>

      {problem && (
        <p className="mt-2 text-xs text-red-700" role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}
