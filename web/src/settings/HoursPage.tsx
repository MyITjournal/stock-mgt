import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Button } from '../components/Button';
import { Field, Input } from '../components/Field';
import { api, ApiError } from '../api/client';
import { useIsManager } from '../auth/useAuth';
import type { components } from '../api/schema';

type OrganizationView = components['schemas']['OrganizationView'];

/** 0 is Sunday, matching `Date.getDay()` on the server. */
const DAYS = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

/** 480 becomes "08:00", which is what a time input wants. */
function toClock(minutes: number): string {
  const hours = Math.floor(minutes / 60)
    .toString()
    .padStart(2, '0');
  return `${hours}:${(minutes % 60).toString().padStart(2, '0')}`;
}

function toMinutes(clock: string): number {
  const [hours, minutes] = clock.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * When the shop is open, and therefore when staff can sign in.
 *
 * **Working hours gate signing in, not working** (DECISIONS.md §9). The check
 * runs when a session is issued or renewed — never on an ordinary request — so
 * somebody is locked out within fifteen minutes of closing and never
 * mid-sale. That distinction is on the screen, because "opening hours" reads
 * like it might stop a cashier halfway through a customer, and it does not.
 *
 * Two rules the form has to hold:
 *
 * - **No window crosses midnight.** A CHECK enforces it, and that is what
 *   makes night shifts a real change later rather than a flag.
 * - **At least one working day.** An empty list means *no* day is a working
 *   day, which locks every member of staff out. The server refuses it; this
 *   form refuses it first, so nobody discovers the rule by trying it.
 */
export function HoursPage() {
  const { data, isPending } = useQuery({
    queryKey: ['organization'],
    queryFn: () => api.get<OrganizationView>('/organization'),
  });

  if (isPending || !data) {
    return (
      <Page title="Opening hours">
        <p className="text-sm text-slate-500">Loading…</p>
      </Page>
    );
  }

  // Mounts already holding the saved hours, so nothing has to sync state to
  // props after the fact.
  return <HoursForm key={data.id} organization={data} />;
}

function HoursForm({ organization }: { organization: OrganizationView }) {
  const queryClient = useQueryClient();
  const canEdit = useIsManager();
  const data = organization;

  const [opensAt, setOpensAt] = useState(toClock(data.opensAt));
  const [closesAt, setClosesAt] = useState(toClock(data.closesAt));
  const [days, setDays] = useState<number[]>(data.workingDays);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);


  const save = useMutation({
    mutationFn: () =>
      api.patch<OrganizationView>('/organization', {
        opensAt: toMinutes(opensAt),
        closesAt: toMinutes(closesAt),
        workingDays: [...days].sort((a, b) => a - b),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['organization'] });
      setError(null);
      setSaved(true);
    },
    onError: (caught) => {
      setSaved(false);
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not save those hours.',
      );
    },
  });

  const toggle = (day: number) => {
    setSaved(false);
    setDays((current) =>
      current.includes(day)
        ? current.filter((value) => value !== day)
        : [...current, day],
    );
  };

  const crossesMidnight = toMinutes(closesAt) <= toMinutes(opensAt);
  const noDays = days.length === 0;
  const ready = !crossesMidnight && !noDays;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (ready) save.mutate();
  };

  return (
    <Page
      title="Opening hours"
      description="When staff can sign in — not when they can work."
    >
      <form onSubmit={submit} className="max-w-2xl space-y-6">
        <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
          These are checked when somebody <strong>signs in</strong> or their
          session renews, never on an ordinary request. A cashier is locked out
          within about fifteen minutes of closing, and never in the middle of a
          sale. Times are in {data?.timezone}.
        </p>

        <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Opens" htmlFor="opens-at">
              <Input
                id="opens-at"
                type="time"
                value={opensAt}
                onChange={(event) => {
                  setOpensAt(event.target.value);
                  setSaved(false);
                }}
                disabled={!canEdit}
              />
            </Field>

            <Field label="Closes" htmlFor="closes-at">
              <Input
                id="closes-at"
                type="time"
                value={closesAt}
                onChange={(event) => {
                  setClosesAt(event.target.value);
                  setSaved(false);
                }}
                disabled={!canEdit}
              />
            </Field>
          </div>

          {crossesMidnight && (
            <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              Closing has to be later than opening. A shift running past
              midnight is not supported yet — it needs two windows rather than
              one, which is a real change rather than a setting.
            </p>
          )}

          <div>
            <span className="block text-sm font-medium text-slate-700">
              Days you open
            </span>
            <div className="mt-2 flex flex-wrap gap-1">
              {DAYS.map((day) => (
                <button
                  key={day.value}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => toggle(day.value)}
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

            {noDays && (
              <p className="mt-2 rounded-md bg-red-50 p-3 text-sm text-red-700">
                Choose at least one day. A business open on no days locks every
                member of staff out — owners can still get in and put it right,
                but nobody else could sign in at all.
              </p>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Who these do not apply to
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-slate-600">
            <li>
              <strong>Owners are never locked out</strong>, whatever these say.
            </li>
            <li>
              Anybody else can be exempted, or given their own hours, on the{' '}
              <strong>Staff</strong> tab. Leaving a person&rsquo;s own hours
              blank means they follow the business, so a new hire is covered
              without anybody remembering to set them.
            </li>
          </ul>
        </section>

        {error && (
          <p
            className="rounded-md bg-red-50 p-3 text-sm text-red-700"
            role="alert"
          >
            {error}
          </p>
        )}

        {saved && (
          <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
            Saved. This applies the next time somebody signs in or their
            session renews.
          </p>
        )}

        {canEdit ? (
          <div className="flex justify-end">
            <Button type="submit" disabled={save.isPending || !ready}>
              {save.isPending ? 'Saving…' : 'Save hours'}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            Only an owner or a manager can change these.
          </p>
        )}
      </form>
    </Page>
  );
}
