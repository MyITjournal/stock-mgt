import { DialogClose } from '../components/DialogClose';
import { Money } from '../components/Money';
import type { components } from '../api/schema';

type ScanResult = components['schemas']['ScanResult'];
type ScannedOption = ScanResult['options'][number];

/**
 * "Which one?" — a code on a product with options that names none of them
 * (DECISIONS.md §24).
 *
 * Eva soap's carton barcode is the same whichever soap is inside, so the scan
 * finds the product but not the option. Every active option comes back with
 * the scan, already priced, so one tap adds it with no further request.
 */
export function OptionPicker({
  scan,
  onPick,
  onCancel,
}: {
  scan: ScanResult;
  onPick: (option: ScannedOption) => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="option-picker-title"
    >
      <div className="relative w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-lg">
        <DialogClose onClose={onCancel} />

        <h2
          id="option-picker-title"
          className="text-lg font-semibold text-slate-900"
        >
          Which {scan.product.name}?
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          This code is on every option. Tap the one being sold — one{' '}
          {scan.unit.name}.
        </p>

        <ul className="mt-4 divide-y divide-slate-100 rounded-md border border-slate-200">
          {scan.options.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                onClick={() => onPick(option)}
                className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left text-sm hover:bg-slate-50"
              >
                <span className="font-medium text-slate-900">
                  {option.name}
                </span>
                {option.price === null ? (
                  <span className="text-xs text-amber-700">No price</span>
                ) : (
                  <Money value={option.price} />
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
