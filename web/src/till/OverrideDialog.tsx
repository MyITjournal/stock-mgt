import { useState, type FormEvent } from 'react';
import { Button } from '../components/Button';
import { Field, Input } from '../components/Field';

/**
 * Which rule the server just refused to break.
 *
 * Both are 409s, both are overridable by an owner or a manager, and both record
 * the reason on the row — but they are different decisions and a shop should be
 * told which one it is making.
 */
export type OverrideKind = 'stock' | 'credit';

const COPY: Record<
  OverrideKind,
  { title: string; hint: string; placeholder: string; confirm: string }
> = {
  stock: {
    title: 'Not enough stock for this sale',
    hint: 'The ledger cannot cover what is being sold. Selling anyway records the shortfall against your name, and the reason is kept on the movement.',
    placeholder: 'Sold from the van before the delivery was entered.',
    confirm: 'Sell anyway',
  },
  credit: {
    title: 'This customer still owes',
    hint: 'Money already out with this customer has not been cleared. Giving more credit is allowed, but the reason is recorded on the sale so it can be found later.',
    placeholder: 'Owner approved; paying both invoices on Friday.',
    confirm: 'Give credit anyway',
  },
};

/**
 * The reason box that stands between a refusal and an override.
 *
 * **Supplying the reason *is* the override** — there is no separate switch —
 * so one can never be recorded without an explanation (DECISIONS.md §5, §6).
 * That is why the confirm button stays disabled until something is typed:
 * the server would reject an empty reason anyway, and finding out after
 * a second round trip is worse.
 *
 * Someone who is not an owner or a manager never sees this. They get the
 * refusal and the message, which is the truthful outcome — the server would
 * refuse them regardless of what this component rendered (§9).
 */
export function OverrideDialog({
  kind,
  serverMessage,
  onConfirm,
  onCancel,
  busy,
}: {
  kind: OverrideKind;
  serverMessage: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [reason, setReason] = useState('');
  const copy = COPY[kind];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = reason.trim();
    if (trimmed) onConfirm(trimmed);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="override-title"
    >
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-lg"
      >
        <h2
          id="override-title"
          className="text-lg font-semibold text-slate-900"
        >
          {copy.title}
        </h2>

        {/* The server's own words. It names the shortfall or the balance, and
            a paraphrase would drop the number that makes it actionable. */}
        <p className="mt-2 rounded-md bg-slate-50 p-3 text-sm text-slate-700">
          {serverMessage}
        </p>

        <p className="mt-3 text-sm text-slate-500">{copy.hint}</p>

        <div className="mt-4">
          <Field label="Reason" htmlFor="override-reason">
            <Input
              id="override-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={copy.placeholder}
              autoFocus
              required
            />
          </Field>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={busy || !reason.trim()}>
            {busy ? 'Recording…' : copy.confirm}
          </Button>
        </div>
      </form>
    </div>
  );
}
