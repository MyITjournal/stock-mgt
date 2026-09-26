import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Button } from '../components/Button';
import { Field, Input, Select } from '../components/Field';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/useAuth';
import type { components } from '../api/schema';
import { StaffHoursDialog } from './StaffHoursDialog';

type StaffMemberView = components['schemas']['StaffMemberView'];
type OrganizationView = components['schemas']['OrganizationView'];
type OrgRole = components['schemas']['OrgRole'];

const ROLES: { value: OrgRole; label: string; note: string }[] = [
  { value: 'owner', label: 'Owner', note: 'Everything, and never locked out' },
  { value: 'manager', label: 'Manager', note: 'Everything except staff' },
  { value: 'accountant', label: 'Accountant', note: 'Money and reports' },
  { value: 'storekeeper', label: 'Storekeeper', note: 'Stock and deliveries' },
  { value: 'sales_rep', label: 'Sales rep', note: 'Selling; no buying prices' },
];

function fullName(user: StaffMemberView['user']): string {
  return `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || 'Unnamed';
}

/**
 * Who works here.
 *
 * **Most cashiers in this market have no working email address**, which shapes
 * this whole screen (DECISIONS.md §9): `username` sits beside `email` and is
 * stored qualified by the shop, accounts are created **pre-verified** because a
 * code would never arrive, and the owner sets and resets passwords because
 * self-service reset can never reach somebody with no address.
 *
 * Three rules the screen has to respect, all enforced by the server:
 *
 * - **Removal is suspension.** Their name is on sales, payments and stock
 *   movements. It takes effect on their next request, not when their token
 *   expires, and it frees their seat.
 * - **The last owner cannot be demoted or suspended**, and nobody can change
 *   their own role — a business with no owner has nobody who can manage staff.
 * - **Seats are counted on adding and reactivating, never on signing in**, so a
 *   business over its limit keeps working.
 *
 * Writes here are owner-only. A manager can read the list, because knowing who
 * works here is not a privilege.
 */
export function StaffPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isOwner = user?.orgRole === 'owner';

  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<StaffMemberView | null>(null);
  const [editingHours, setEditingHours] = useState<StaffMemberView | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const { data: staff = [], isPending } = useQuery({
    queryKey: ['staff'],
    queryFn: () => api.get<StaffMemberView[]>('/staff'),
  });

  const { data: organization } = useQuery({
    queryKey: ['organization'],
    queryFn: () => api.get<OrganizationView>('/organization'),
  });

  const change = useMutation({
    mutationFn: (input: {
      userId: string;
      body: Record<string, unknown>;
    }) => api.patch<StaffMemberView>(`/staff/${input.userId}`, input.body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['staff'] });
      setError(null);
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError ? caught.message : 'Could not change that.',
      ),
  });

  const active = staff.filter((member) => member.status === 'active').length;
  const seats = organization?.maxUsers;
  const full = seats !== undefined && active >= seats;

  return (
    <Page
      title="Staff"
      description="Who works here, what they may do, and when they can sign in."
      actions={
        isOwner ? (
          <Button onClick={() => setAdding(true)} disabled={full}>
            Add somebody
          </Button>
        ) : undefined
      }
    >
      {seats !== undefined && (
        <p
          className={`mb-4 rounded-md p-3 text-sm ${
            full ? 'bg-amber-50 text-amber-900' : 'bg-slate-50 text-slate-600'
          }`}
        >
          <strong>
            {active} of {seats}
          </strong>{' '}
          {seats === 1 ? 'seat' : 'seats'} in use.{' '}
          {full
            ? 'Suspend somebody who has left to free one, or move up a plan. Everybody already here keeps working — the limit is only checked when somebody is added or brought back.'
            : 'Only active people hold a seat; somebody suspended does not.'}
        </p>
      )}

      {error && (
        <p
          className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700"
          role="alert"
        >
          {error}
        </p>
      )}

      {note && (
        <p className="mb-4 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
          {note}
        </p>
      )}

      {isPending && <p className="text-sm text-slate-500">Loading…</p>}

      <div className="space-y-3">
        {staff.map((member) => {
          const isSelf = member.user.id === user?.sub;
          const suspended = member.status === 'suspended';

          return (
            <article
              key={member.id}
              className={`rounded-lg border border-slate-200 bg-white p-4 ${
                suspended ? 'opacity-60' : ''
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900">
                      {fullName(member.user)}
                    </span>
                    {isSelf && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                        you
                      </span>
                    )}
                    {suspended && (
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600">
                        suspended
                      </span>
                    )}
                  </div>

                  <p className="mt-0.5 text-xs text-slate-500">
                    {/* Absent rather than null for a reader who may not see
                        it: a manager gets names and roles only. */}
                    {member.user.username ??
                      member.user.email ??
                      'signs in with a username'}
                  </p>

                  {member.ignoresWorkingHours !== undefined && (
                    <p className="mt-1 text-xs text-slate-500">
                      {member.role === 'owner'
                        ? 'Never locked out — owners always are not.'
                        : member.ignoresWorkingHours
                          ? 'Exempt from opening hours'
                          : member.opensAt === null
                            ? 'Follows the business hours'
                            : `Own hours: ${formatHours(member)}`}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {isOwner ? (
                    <Select
                      aria-label={`Role for ${fullName(member.user)}`}
                      value={member.role}
                      disabled={isSelf || change.isPending}
                      onChange={(event) =>
                        change.mutate({
                          userId: member.user.id,
                          body: { role: event.target.value },
                        })
                      }
                      className="w-40"
                    >
                      {ROLES.map((role) => (
                        <option key={role.value} value={role.value}>
                          {role.label}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <span className="text-sm text-slate-600">
                      {ROLES.find((role) => role.value === member.role)
                        ?.label ?? member.role}
                    </span>
                  )}

                  {isOwner && !isSelf && (
                    <>
                      <Button
                        variant="secondary"
                        onClick={() => setEditingHours(member)}
                      >
                        Hours
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => setResetting(member)}
                      >
                        Reset password
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={change.isPending || (suspended && full)}
                        onClick={() =>
                          change.mutate({
                            userId: member.user.id,
                            body: {
                              status: suspended ? 'active' : 'suspended',
                            },
                          })
                        }
                      >
                        {suspended ? 'Bring back' : 'Suspend'}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {!isOwner && (
        <p className="mt-4 text-sm text-slate-500">
          Only an owner can add somebody, change a role or reset a password.
        </p>
      )}

      {adding && (
        <AddStaffDialog
          slug={organization?.slug ?? ''}
          onClose={() => setAdding(false)}
        />
      )}

      {resetting && (
        <ResetPasswordDialog
          member={resetting}
          onDone={(message) => {
            setNote(message);
            setResetting(null);
          }}
          onClose={() => setResetting(null)}
        />
      )}

      {editingHours && (
        <StaffHoursDialog
          member={editingHours}
          onClose={() => setEditingHours(null)}
        />
      )}
    </Page>
  );
}

function formatHours(member: StaffMemberView): string {
  const clock = (minutes: number | null | undefined) =>
    minutes === null || minutes === undefined
      ? '—'
      : `${Math.floor(minutes / 60)
          .toString()
          .padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}`;
  return `${clock(member.opensAt)}–${clock(member.closesAt)}`;
}

function AddStaffDialog({
  slug,
  onClose,
}: {
  slug: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [signInWith, setSignInWith] = useState<'username' | 'email'>(
    'username',
  );
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<OrgRole>('sales_rep');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.post<StaffMemberView>('/staff', {
        firstName: firstName.trim(),
        ...(lastName.trim() ? { lastName: lastName.trim() } : {}),
        ...(signInWith === 'username'
          ? { username: username.trim() }
          : { email: email.trim() }),
        password,
        role,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['staff'] });
      onClose();
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not add that person.',
      ),
  });

  const ready =
    firstName.trim() &&
    password.length >= 8 &&
    (signInWith === 'username' ? username.trim().length >= 2 : email.trim());

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (ready) create.mutate();
  };

  return (
    <Shell title="Add somebody" labelledBy="add-staff" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name" htmlFor="staff-first">
              <Input
                id="staff-first"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                autoFocus
                required
              />
            </Field>
            <Field label="Last name" htmlFor="staff-last">
              <Input
                id="staff-last"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
              />
            </Field>
          </div>

          <div>
            <span className="block text-sm font-medium text-slate-700">
              They sign in with
            </span>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(['username', 'email'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setSignInWith(option)}
                  className={`rounded-md border px-3 py-2 text-sm transition ${
                    signInWith === option
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {option === 'username' ? 'A username' : 'An email address'}
                </button>
              ))}
            </div>
          </div>

          {signInWith === 'username' ? (
            <Field
              label="Username"
              htmlFor="staff-username"
              hint={
                slug
                  ? `Stored as ${username.trim() || 'name'}@${slug}, so another shop can still have one.`
                  : 'Stored qualified by your shop.'
              }
            >
              <Input
                id="staff-username"
                value={username}
                onChange={(event) =>
                  setUsername(
                    event.target.value.replace(/[^a-zA-Z0-9._-]/g, ''),
                  )
                }
                placeholder="amina"
                required
              />
            </Field>
          ) : (
            <Field
              label="Email"
              htmlFor="staff-email"
              hint="Only for staff who actually have one — they can then reset their own password."
            >
              <Input
                id="staff-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </Field>
          )}

          <Field
            label="First password"
            htmlFor="staff-password"
            hint="You set this and tell them. At least 8 characters."
          >
            <Input
              id="staff-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </Field>

          <Field label="Role" htmlFor="staff-role">
            <Select
              id="staff-role"
              value={role}
              onChange={(event) => setRole(event.target.value as OrgRole)}
            >
              {ROLES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} — {option.note}
                </option>
              ))}
            </Select>
          </Field>

          <p className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">
            The account is created <strong>already verified</strong>: a
            confirmation code would never arrive for somebody with no email
            address, and you vouching for them in person is the verification.
          </p>
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
          busy={create.isPending}
          ready={Boolean(ready)}
          confirm="Add them"
        />
      </form>
    </Shell>
  );
}

function ResetPasswordDialog({
  member,
  onDone,
  onClose,
}: {
  member: StaffMemberView;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reset = useMutation({
    mutationFn: () =>
      api.post<{ message: string }>(`/staff/${member.user.id}/password`, {
        password,
      }),
    onSuccess: (result) => onDone(result.message),
    onError: (caught) =>
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not reset that password.',
      ),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password.length >= 8) reset.mutate();
  };

  return (
    <Shell
      title={`Reset password for ${fullName(member.user)}`}
      labelledBy="reset-password"
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <p className="text-sm text-slate-500">
          You set it and tell them. Somebody with no email address cannot use
          the self-service reset, which is why this exists.
        </p>

        <div className="mt-4">
          <Field
            label="New password"
            htmlFor="new-password"
            hint="At least 8 characters."
          >
            <Input
              id="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoFocus
              required
            />
          </Field>
        </div>

        <p className="mt-3 rounded-md bg-amber-50 p-3 text-xs text-amber-900">
          This signs them out everywhere immediately. Without that, their phone
          would keep renewing its session for up to a week on the old password
          — and you would believe you had locked them out.
        </p>

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
          busy={reset.isPending}
          ready={password.length >= 8}
          confirm="Set password"
        />
      </form>
    </Shell>
  );
}

export function Shell({
  title,
  labelledBy,
  onClose,
  children,
}: {
  title: string;
  labelledBy: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onKeyDown={(event) => event.key === 'Escape' && onClose()}
    >
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-lg">
        <h2 id={labelledBy} className="text-lg font-semibold text-slate-900">
          {title}
        </h2>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

export function Actions({
  onClose,
  busy,
  ready,
  confirm,
}: {
  onClose: () => void;
  busy: boolean;
  ready: boolean;
  confirm: string;
}) {
  return (
    <div className="mt-6 flex justify-end gap-2">
      <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
        Cancel
      </Button>
      <Button type="submit" disabled={busy || !ready}>
        {busy ? 'Saving…' : confirm}
      </Button>
    </div>
  );
}
