import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Input } from '../components/Field';

/**
 * The one input a till is driven from.
 *
 * **A barcode scanner is a keyboard.** A USB scanner types the digits and
 * presses Enter, which means the entire fast path costs nothing but keeping a
 * text box focused and listening for submit (DECISIONS.md §17). No device
 * integration, no drivers, no permissions prompt.
 *
 * Which is also why focus is stolen back so insistently. If the caret drifts
 * into a quantity field, the next scan types a barcode into it and the sale is
 * silently wrong — so anything that is not a form control hands focus back, and
 * every completed scan returns it here.
 */
export function ScanBox({
  onSubmit,
  busy,
  disabled,
}: {
  onSubmit: (value: string) => void;
  busy: boolean;
  disabled?: boolean;
}) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  // Refocus whenever the till goes idle again — after a lookup resolves, after
  // a dialog closes, after a sale completes.
  useEffect(() => {
    if (!busy && !disabled) ref.current?.focus();
  }, [busy, disabled]);

  useEffect(() => {
    if (disabled) return;

    const returnFocus = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      // Leave real controls alone: someone clicking a quantity box means to
      // type in it. Everything else is dead space, and dead space should not
      // cost the next scan.
      if (target?.closest('input, select, textarea, button, a, [role="dialog"]')) {
        return;
      }
      ref.current?.focus();
    };

    document.addEventListener('click', returnFocus);
    return () => document.removeEventListener('click', returnFocus);
  }, [disabled]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue('');
  };

  return (
    <form onSubmit={submit}>
      <label htmlFor="scan" className="sr-only">
        Scan a barcode or search by name
      </label>
      <Input
        id="scan"
        ref={ref}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Scan a barcode, or type a name or SKU and press Enter"
        autoComplete="off"
        autoFocus
        disabled={disabled}
        className="h-12 text-base"
      />
      <p className="mt-1 text-xs text-slate-500">
        {busy ? 'Looking that up…' : 'A scanner types the code and presses Enter for you.'}
      </p>
    </form>
  );
}
