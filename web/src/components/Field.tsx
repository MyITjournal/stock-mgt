import type {
  ComponentProps,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';

/**
 * Form primitives, deliberately not a form engine.
 *
 * Label, hint and error wiring done once and consistently, because that is the
 * part that is tedious to repeat and easy to get wrong for a screen reader.
 * Validation, state and submission stay with the screen — roughly twenty CRUD
 * forms is not enough to justify an abstraction that has to be learned, and
 * the server validates everything regardless.
 */

const inputStyles =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 ' +
  'placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-2 ' +
  'focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-50';

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="block text-sm font-medium text-slate-700"
      >
        {label}
      </label>
      <div className="mt-1">{children}</div>
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && (
        <p className="mt-1 text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * `ComponentProps<'input'>` rather than `InputHTMLAttributes`, so `ref` passes
 * through: React 19 hands a function component its ref as an ordinary prop, and
 * the till needs one to keep the scan box focused.
 */
export function Input(props: ComponentProps<'input'>) {
  const { className = '', ...rest } = props;
  return <input {...rest} className={`${inputStyles} ${className}`.trim()} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = '', ...rest } = props;
  return <select {...rest} className={`${inputStyles} ${className}`.trim()} />;
}

/**
 * An amount field.
 *
 * Takes and returns **minor units**, so a caller never sees a decimal and can
 * never accidentally send one. Typing happens in major units because that is
 * what a person reads off an invoice; the conversion is the one job this has.
 */
export function MoneyInput({
  value,
  onChange,
  id,
  ...rest
}: {
  value: number | null;
  onChange: (minor: number | null) => void;
  id: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'id'>) {
  return (
    <Input
      {...rest}
      id={id}
      inputMode="decimal"
      value={value === null ? '' : (value / 100).toFixed(2)}
      onChange={(event) => {
        const raw = event.target.value.trim();
        if (raw === '') {
          onChange(null);
          return;
        }
        const major = Number(raw.replace(/,/g, ''));
        onChange(Number.isFinite(major) ? Math.round(major * 100) : null);
      }}
    />
  );
}
