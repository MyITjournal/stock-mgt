import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Button } from '../components/Button';
import { Field, Input } from '../components/Field';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/useAuth';

/**
 * Changing your own password.
 *
 * ## Why this screen has to exist
 *
 * On the hosted instance `SELF_SERVE_SIGNUP` is off, which closes
 * `forgot-password` along with registration (DECISIONS.md §20). Without this
 * screen the password an owner is handed at setup would be the password they
 * are stuck with, and the only way to change it would be to ask us to run a
 * script. The endpoint alone does not fix that — an endpoint nobody can reach
 * is the same gap in a different place.
 *
 * ## Why it does not live behind a role check
 *
 * Everybody has a password, so everybody can change one. This is the single
 * screen in settings that a cashier has business on, which is why it is not
 * grouped with the letterhead and the hours.
 */
export function PasswordPage() {
  const { user } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);

  const change = useMutation({
    mutationFn: () =>
      api.post<{ message: string }>('/auth/change-password', {
        currentPassword: current,
        newPassword: next,
      }),
    onSuccess: () => {
      setDone(true);
      setCurrent('');
      setNext('');
      setConfirm('');
    },
  });

  // Checked here as well as on the server so the mismatch is caught before a
  // request is spent — the server never sees the confirmation field at all,
  // because "twice" is a typing aid rather than part of the change.
  const mismatch = confirm.length > 0 && next !== confirm;
  const tooShort = next.length > 0 && next.length < 8;
  const ready = current && next.length >= 8 && next === confirm;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (ready) change.mutate();
  };

  // No name beside the title when there is no email: the token's `email` claim
  // is null for staff who sign in with a username, and it deliberately does not
  // fall back to that username (DECISIONS.md §9). Inventing a label here would
  // mean reading an identifier from somewhere it was kept out of on purpose.
  return (
    <Page
      title="Your password"
      description={
        user?.email ? `Signed in as ${user.email}.` : 'For this sign-in.'
      }
    >
      <form
        onSubmit={onSubmit}
        className="max-w-sm rounded-xl border border-slate-200 bg-white p-6"
      >
        <div className="space-y-4">
          <Field
            label="Current password"
            htmlFor="current"
            hint="Asked for because being signed in is not the same as knowing the password."
          >
            <Input
              id="current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
            />
          </Field>

          <Field
            label="New password"
            htmlFor="next"
            hint="At least 8 characters."
            error={tooShort ? 'That is shorter than 8 characters.' : undefined}
          >
            <Input
              id="next"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
            />
          </Field>

          <Field
            label="New password again"
            htmlFor="confirm"
            error={mismatch ? 'These two do not match.' : undefined}
          >
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </Field>
        </div>

        {change.error && (
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {change.error instanceof ApiError
              ? change.error.message
              : 'Could not change your password.'}
          </p>
        )}

        {done && (
          <p className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Password changed. Anyone else signed in as you has been signed out.
          </p>
        )}

        <Button type="submit" className="mt-6" disabled={!ready || change.isPending}>
          {change.isPending ? 'Changing…' : 'Change password'}
        </Button>

        {/*
          Said before it happens rather than after. Changing a password revokes
          every session, which is the point when the reason for changing it is
          that somebody else knows it — but it also signs out the phone in your
          pocket, and that should not be a surprise.
        */}
        <p className="mt-4 text-xs text-slate-500">
          This signs out every other device you are signed in on. This one stays
          signed in.
        </p>
      </form>
    </Page>
  );
}
