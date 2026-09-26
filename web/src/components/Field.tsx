import { useState } from 'react';
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
 *
 * ## Why it holds the typed text instead of re-formatting as you go
 *
 * The first version rendered `(value / 100).toFixed(2)` on every keystroke,
 * and that made the field impossible to type into. Typing `3` stored 300 kobo
 * and rendered back `3.00` with the caret at the end; the next digit made
 * `3.000`, which parses to the same 300 kobo and renders `3.00` again. Every
 * keystroke after the first was swallowed, and the only way to enter 3,300.00
 * was to arrow back to the start and type the digits in front. Nobody can
 * price a product that way.
 *
 * So the formatted value is what the field shows when it is **not** being
 * typed into. While it has focus it shows the draft — exactly the characters
 * that were typed, including a trailing `.` mid-number — and blurring throws
 * the draft away so the canonical two-decimal form comes back.
 *
 * The value still leaves as minor units on every keystroke, so callers see no
 * change: a parent reading the amount mid-typing gets the same integers it
 * always did. Text that is not a number yet (`-`, `1.2.3`) emits nothing and
 * holds the last good value, rather than reporting null and making a parent
 * think the field was cleared.
 */
export function MoneyInput({
  value,
  onChange,
  id,
  onBlur,
  ...rest
}: {
  value: number | null;
  onChange: (minor: number | null) => void;
  id: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'id'>) {
  /** What was typed, while it is being typed. Null means "show the value". */
  const [draft, setDraft] = useState<string | null>(null);

  const formatted = value === null ? '' : (value / 100).toFixed(2);

  return (
    <Input
      {...rest}
      id={id}
      inputMode="decimal"
      value={draft ?? formatted}
      onChange={(event) => {
        const typed = event.target.value;
        setDraft(typed);

        const cleaned = typed.replace(/[\s,₦]/g, '');
        if (cleaned === '') {
          onChange(null);
          return;
        }

        const major = Number(cleaned);
        if (Number.isFinite(major)) onChange(Math.round(major * 100));
      }}
      onBlur={(event) => {
        // Dropping the draft is what puts the field back into its canonical
        // form — "3300" becomes "3300.00" the moment you leave it.
        setDraft(null);
        onBlur?.(event);
      }}
    />
  );
}
