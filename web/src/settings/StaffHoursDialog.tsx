import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Field, Input } from '../components/Field';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import type { components } from '../api/schema';
import { Actions, Shell } from './StaffPage';

type StaffMemberView = components['schemas']['StaffMemberView'];

const DAYS = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

function toClock(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '';
  return `${Math.floor(minutes / 60)
    .toString()
    .padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}`;
}

function toMinutes(clock: string): number | null {
  if (!clock) return null;
  const [hours, minutes] = clock.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * One person's own hours.
 *
 * **Null means inherit**, and that is the whole reason these live on the
 * membership rather than only on the organization (DECISIONS.md §9): a new
 * hire is covered by the business hours without anybody remembering to set
 * them, and only somebody who genuinely differs needs a row of their own.
 *
 * So "clear" is a real action here, not an empty form — and unlike the
 * organization's list, an **empty set of days means "follow the business"**
 * rather than "never". The dialog says which is which, because the two look
 * identical and mean opposite things.
 */
export function StaffHoursDialog({
  member,
  onClose,
}: {
  member: StaffMemberView;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const [opensAt, setOpensAt] = useState(toClock(member.opensAt));
  const [closesAt, setClosesAt] = useState(toClock(member.closesAt));
  const [days, setDays] = useState<number[]>(member.workingDays ?? []);
  const [exempt, setExempt] = useState(member.ignoresWorkingHours ?? false);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      api.patch<StaffMemberView>(`/staff/${member.user.id}`, {
        opensAt: toMinutes(opensAt),
        closesAt: toMinutes(closesAt),
        workingDays: [...days].sort((a, b) => a - b),
        ignoresWorkingHours: exempt,
      }),
    onSuccess: () => {
      afterWrite(queryClient);
      onClose();
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not save those hours.',
      ),
  });

  // Either both times or neither: one alone has nothing to compare against,
  // and the server reads a null as "inherit".
  const halfSet = Boolean(opensAt) !== Boolean(closesAt);
  const backwards =
    Boolean(opensAt && closesAt) &&
    toMinutes(closesAt)! <= toMinutes(opensAt)!;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!halfSet && !backwards) save.mutate();
  };

  const name =
    `${member.user.firstName ?? ''} ${member.user.lastName ?? ''}`.trim() ||
    'this person';

  return (
    <Shell
      title={`Hours for ${name}`}
      labelledBy="staff-hours"
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <p className="text-sm text-slate-500">
          Leave these blank and they follow the business hours — which is what
          you want for almost everybody.
        </p>

        <div className="mt-4 space-y-4">
          <label className="flex items-start gap-2 rounded-md bg-slate-50 p-3 text-sm">
            <input
              type="checkbox"
              checked={exempt}
              onChange={(event) => setExempt(event.target.checked)}
              className="mt-0.5"
            />
            <span className="text-slate-700">
              Can sign in at any time
              <span className="block text-xs text-slate-500">
                Ignores opening hours entirely. Owners already do.
              </span>
            </span>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Opens" htmlFor="member-opens">
              <Input
                id="member-opens"
                type="time"
                value={opensAt}
                onChange={(event) => setOpensAt(event.target.value)}
                disabled={exempt}
              />
            </Field>
            <Field label="Closes" htmlFor="member-closes">
              <Input
                id="member-closes"
                type="time"
                value={closesAt}
                onChange={(event) => setClosesAt(event.target.value)}
                disabled={exempt}
              />
            </Field>
          </div>

          {halfSet && (
            <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              Set both times, or neither. One on its own has nothing to be
              measured against, so it would silently fall back to the business
              hours.
            </p>
          )}

          {backwards && (
            <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              Closing has to be later than opening — no window crosses
              midnight.
            </p>
          )}

          <div>
            <span className="block text-sm font-medium text-slate-700">
              Days they work
            </span>
            <div className="mt-2 flex flex-wrap gap-1">
              {DAYS.map((day) => (
                <button
                  key={day.value}
                  type="button"
                  disabled={exempt}
                  onClick={() =>
                    setDays((current) =>
                      current.includes(day.value)
                        ? current.filter((value) => value !== day.value)
                        : [...current, day.value],
                    )
                  }
                  className={`rounded-md border px-3 py-1.5 text-sm transition disabled:opacity-60 ${
                    days.includes(day.value)
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {day.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {days.length === 0
                ? 'None chosen, so they follow the days the business opens.'
                : `Saturdays-only staff and the like. Choosing none puts them back on the business's days.`}
            </p>
          </div>
        </div>

        {error && (
          <p
            className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700"
            role="alert"
          >
            {error}
          </p>
        )}

        <Actions
          onClose={onClose}
          busy={save.isPending}
          ready={!halfSet && !backwards}
          confirm="Save hours"
        />
      </form>
    </Shell>
  );
}
