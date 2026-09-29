import { useState } from 'react';
import { Input } from './Field';

/**
 * A whole-number box that can actually be typed into.
 *
 * It holds the typed digits while it has focus, for the same reason
 * `MoneyInput` does — and the failure it fixes is the same family. A
 * controlled number input that only commits values it considers valid also
 * rejects the **empty string**, so backspacing to clear it snapped the old
 * number straight back: changing a 1 to a 12, or a carton factor from 12 to
 * 24, meant selecting the whole box first. At a counter that is the
 * difference between fast and infuriating.
 *
 * Digits are **filtered rather than validated**, so there is nothing to
 * reject: no minus sign, no decimal point, no letters can be typed at all.
 * Quantities are integers everywhere (§15) — half a carton is six pieces, and
 * the answer is to switch the unit rather than to type `0.5`.
 *
 * A draft outside the allowed range is **held rather than committed**, so the
 * number behind the screen is always one the caller asked for. Blurring drops
 * the draft, which restores whatever is actually committed.
 */
export function QuantityInput({
  label,
  value,
  onChange,
  id,
  disabled = false,
  min = 1,
  max,
  className,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  id?: string;
  disabled?: boolean;
  /** The smallest value worth committing. Below it, typing is held. */
  min?: number;
  /** The largest, when there is one — how many were sold, say. */
  max?: number;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <Input
      id={id}
      type="text"
      inputMode="numeric"
      aria-label={label}
      value={draft ?? String(value)}
      disabled={disabled}
      className={className}
      onChange={(event) => {
        const digits = event.target.value.replace(/[^\d]/g, '');
        setDraft(digits);
        if (digits === '') return;

        const next = Number(digits);
        if (next >= min && (max === undefined || next <= max)) onChange(next);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}
