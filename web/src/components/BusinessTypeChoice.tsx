import { BUSINESS_TYPES, type BusinessType } from '../lib/businessTypes';

/**
 * Three cards rather than a dropdown, because the descriptions are the point:
 * "Both" alone does not tell anybody whether it is the right answer.
 *
 * A real radio group underneath, so it is reachable by keyboard and read as a
 * single choice by a screen reader. Nothing is pre-selected when `value` is
 * null — on sign-up the question is meant to be answered, not accepted.
 */
export function BusinessTypeChoice({
  value,
  onChange,
  name = 'business-type',
}: {
  value: BusinessType | null;
  onChange: (next: BusinessType) => void;
  name?: string;
}) {
  return (
    <div role="radiogroup" className="space-y-2">
      {BUSINESS_TYPES.map((type) => {
        const checked = value === type.value;
        return (
          <label
            key={type.value}
            className={`flex cursor-pointer gap-3 rounded-lg border px-3 py-2.5 transition ${
              checked
                ? 'border-brand-600 bg-brand-50'
                : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            <input
              type="radio"
              name={name}
              value={type.value}
              checked={checked}
              onChange={() => onChange(type.value)}
              className="mt-1 accent-brand-600"
            />
            <span>
              <span className="block text-sm font-medium text-slate-900">
                {type.label}
              </span>
              <span className="block text-xs text-slate-500">
                {type.description}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
