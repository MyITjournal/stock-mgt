import { Money } from '../components/Money';
import { MoneyInput, Select } from '../components/Field';
import { Button } from '../components/Button';
import { isOverridden, lineTotal, type CartLine } from './cart';

/**
 * The cart: what is being sold, in what unit, at what price.
 *
 * Every row is editable because every one of them is negotiable at a counter.
 * The unit matters most — a carton and a piece are the same product at a
 * twenty-fold difference in price — and changing it re-prices the line through
 * the server rather than in the browser, which is why `onUnitChange` is async
 * and not a local multiplication.
 */
export function CartLines({
  lines,
  onQuantityChange,
  onUnitChange,
  onPriceChange,
  onResetPrice,
  onRemove,
  busy,
}: {
  lines: CartLine[];
  onQuantityChange: (key: string, quantity: number) => void;
  onUnitChange: (key: string, unitId: string) => void;
  onPriceChange: (key: string, price: number | null) => void;
  onResetPrice: (key: string) => void;
  onRemove: (key: string) => void;
  busy: boolean;
}) {
  if (lines.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center">
        <p className="text-sm text-slate-500">Nothing in the cart yet.</p>
        <p className="mt-1 text-xs text-slate-400">
          Scan an item, or type a name and press Enter.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2 font-medium">Item</th>
            <th className="px-4 py-2 font-medium">Unit</th>
            <th className="px-4 py-2 font-medium">Qty</th>
            <th className="px-4 py-2 text-right font-medium">Price</th>
            <th className="px-4 py-2 text-right font-medium">Total</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {lines.map((line) => (
            <tr key={line.key} className="align-top">
              <td className="px-4 py-3">
                <div className="font-medium text-slate-900">
                  {line.productName}
                </div>
                <div className="text-xs text-slate-500">{line.sku}</div>
                {!line.isTierPrice && (
                  <div
                    className="mt-1 text-xs text-amber-700"
                    title="No price list covers this unit, so it was worked out from the base price. Check it before selling a carton."
                  >
                    No tier price for this unit
                  </div>
                )}
              </td>

              <td className="px-4 py-3">
                <Select
                  aria-label={`Unit for ${line.productName}`}
                  value={line.unitId}
                  disabled={busy || line.units.length <= 1}
                  onChange={(event) =>
                    onUnitChange(line.key, event.target.value)
                  }
                  className="w-32"
                >
                  {line.units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name}
                      {unit.factor > 1 ? ` (${unit.factor})` : ''}
                    </option>
                  ))}
                </Select>
              </td>

              <td className="px-4 py-3">
                <input
                  type="number"
                  min={1}
                  step={1}
                  aria-label={`Quantity of ${line.productName}`}
                  value={line.quantity}
                  disabled={busy}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    // A till cannot sell nothing, and a negative quantity is a
                    // return — a different act with its own screen in 7.3.
                    if (Number.isInteger(next) && next >= 1) {
                      onQuantityChange(line.key, next);
                    }
                  }}
                  className="w-20 rounded-md border border-slate-300 bg-white px-2 py-2 text-sm tabular-nums focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
                />
              </td>

              <td className="px-4 py-3">
                <div className="flex flex-col items-end gap-1">
                  <MoneyInput
                    id={`price-${line.key}`}
                    aria-label={`Price of one ${line.unitName} of ${line.productName}`}
                    value={line.unitPrice}
                    disabled={busy}
                    onChange={(minor) => onPriceChange(line.key, minor)}
                    className="w-28 text-right"
                  />
                  {isOverridden(line) && (
                    <button
                      type="button"
                      onClick={() => onResetPrice(line.key)}
                      className="text-xs text-slate-500 underline hover:text-slate-700"
                      title="Put the price list price back"
                    >
                      was <Money value={line.listPrice} />
                    </button>
                  )}
                </div>
              </td>

              <td className="px-4 py-3 text-right font-medium text-slate-900">
                <Money value={lineTotal(line)} />
              </td>

              <td className="px-4 py-3 text-right">
                <Button
                  variant="ghost"
                  type="button"
                  disabled={busy}
                  onClick={() => onRemove(line.key)}
                  aria-label={`Remove ${line.productName}`}
                >
                  ×
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
