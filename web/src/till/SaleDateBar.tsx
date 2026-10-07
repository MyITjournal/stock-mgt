import { Button } from '../components/Button';
import { Input } from '../components/Field';
import { today } from '../lib/paidOn';

/** The earliest day the server accepts: a year back (`IsPlausibleOccurrence`). */
function aYearAgo(): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The day the sales being rung up were made (2026-10-06).
 *
 * For entering sales after the fact — a day's notebook typed in the next
 * morning — so each lands in the day it happened: its payment in that day's
 * collections, its stock movement in that day's ledger, its due date five days
 * after it. The server already took a sale's date; the till never sent one.
 *
 * **Owners and managers only**, and it stays on the day picked until changed,
 * so a notebook can be typed in a run. That is why it says so loudly while it
 * is not today: a cashier's ordinary sale filed under last Tuesday would put
 * today's cash-up out by exactly that sale. The prices are today's — a line's
 * price can be changed if it was different then.
 */
export function SaleDateBar({
  day,
  onChange,
  disabled,
}: {
  day: string;
  onChange: (day: string) => void;
  disabled?: boolean;
}) {
  const isToday = day === today();
  const shown = new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <div
      className={`mb-4 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm ${
        isToday
          ? 'border-slate-200 bg-white'
          : 'border-amber-300 bg-amber-50 text-amber-900'
      }`}
    >
      <label htmlFor="sale-day" className="font-medium text-slate-700">
        Sale date
      </label>
      <Input
        id="sale-day"
        type="date"
        value={day}
        min={aYearAgo()}
        max={today()}
        disabled={disabled}
        // An emptied box means today, never "no date".
        onChange={(event) => onChange(event.target.value || today())}
        className="w-44"
      />
      {isToday ? (
        <span className="text-xs text-slate-500">
          Change it to enter sales made on an earlier day.
        </span>
      ) : (
        <>
          <span className="flex-1">
            Sales are being recorded on <strong>{shown}</strong>, at today’s
            prices — change a line’s price if it was different then.
          </span>
          <Button
            variant="secondary"
            onClick={() => onChange(today())}
            disabled={disabled}
          >
            Back to today
          </Button>
        </>
      )}
    </div>
  );
}
