import { Field, Input } from './Field';
import { today } from '../lib/paidOn';

/**
 * "Paid on": the day money actually moved, for a payment recorded after the
 * fact — a bill paid in June but only entered now, a transfer that landed on
 * Friday and is being recorded on Monday.
 *
 * Shared by the customer and the vendor payment forms. Turning the picked day
 * into what is sent — noon UTC, or nothing for today — is `occurredAtFor` in
 * `lib/paidOn.ts`, so that rule lives in one place.
 */
export function PaidOnField({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (day: string) => void;
  disabled?: boolean;
}) {
  return (
    <Field
      label="Paid on"
      htmlFor={id}
      hint="Today, unless you are recording a payment made earlier."
    >
      <Input
        id={id}
        type="date"
        value={value}
        max={today()}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}
