import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Button } from '../components/Button';
import { Field, Input } from '../components/Field';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import { useIsManager } from '../auth/useAuth';
import type { components } from '../api/schema';

type OrganizationView = components['schemas']['OrganizationView'];

/**
 * The business, and the letterhead every printed document carries.
 *
 * **Every field here is optional, and the form must not imply otherwise**
 * (DECISIONS.md §6). A shop that has never opened this screen has to be able
 * to invoice today — the PDF renderer prints what it has. Marking these
 * required would enforce a rule the product deliberately does not have, and
 * would stop somebody invoicing on their first morning.
 *
 * **Currency, timezone and invoice numbering are shown but cannot be changed.**
 * Every report period resolves in the timezone, so changing it would restate
 * history; rewinding the invoice counter would produce duplicate numbers. They
 * are displayed rather than hidden because somebody checking what their
 * invoices will say needs to see them.
 */
export function BusinessPage() {
  const { data, isPending } = useQuery({
    queryKey: ['organization'],
    queryFn: () => api.get<OrganizationView>('/organization'),
  });

  if (isPending || !data) {
    return (
      <Page title="Business">
        <p className="text-sm text-slate-500">Loading…</p>
      </Page>
    );
  }

  // Keyed on the row, so the form is rebuilt if the organization is replaced
  // underneath it — and mounts already holding its values, which is why there
  // is no effect here syncing state to props.
  return <BusinessForm key={data.id} organization={data} />;
}

function BusinessForm({ organization }: { organization: OrganizationView }) {
  const queryClient = useQueryClient();
  const canEdit = useIsManager();
  const data = organization;

  const [form, setForm] = useState({
    name: data.name,
    address: data.address ?? '',
    phone: data.phone ?? '',
    email: data.email ?? '',
    taxId: data.taxId ?? '',
    rcNumber: data.rcNumber ?? '',
    logoUrl: data.logoUrl ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);


  const save = useMutation({
    mutationFn: () =>
      api.patch<OrganizationView>('/organization', {
        name: form.name.trim(),
        // Sent as empty strings rather than omitted: the server reads `''` as
        // "clear this", which is how a field gets emptied once it has been set.
        address: form.address.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        taxId: form.taxId.trim(),
        rcNumber: form.rcNumber.trim(),
        logoUrl: form.logoUrl.trim(),
      }),
    onSuccess: () => {
      afterWrite(queryClient);
      setError(null);
      setSaved(true);
    },
    onError: (caught) => {
      setSaved(false);
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not save those details.',
      );
    },
  });

  const set = (key: keyof typeof form) => (value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (form.name.trim()) save.mutate();
  };

  return (
    <Page
      title="Business"
      description="What prints at the top of an invoice or a statement."
    >
      <form onSubmit={submit} className="max-w-2xl space-y-6">
        <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
          <Field label="Business name" htmlFor="org-name">
            <Input
              id="org-name"
              value={form.name}
              onChange={(event) => set('name')(event.target.value)}
              disabled={!canEdit}
              required
            />
          </Field>

          <Field
            label="Address"
            htmlFor="org-address"
            hint="Optional, like everything below — an invoice prints what it has."
          >
            <Input
              id="org-address"
              value={form.address}
              onChange={(event) => set('address')(event.target.value)}
              placeholder="12 Balogun Street, Lagos"
              disabled={!canEdit}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone" htmlFor="org-phone">
              <Input
                id="org-phone"
                value={form.phone}
                onChange={(event) => set('phone')(event.target.value)}
                placeholder="0803 000 0000"
                disabled={!canEdit}
              />
            </Field>

            <Field label="Email" htmlFor="org-email">
              <Input
                id="org-email"
                type="email"
                value={form.email}
                onChange={(event) => set('email')(event.target.value)}
                disabled={!canEdit}
              />
            </Field>

            <Field
              label="Tax ID"
              htmlFor="org-tax"
              hint="Printed on an invoice when set."
            >
              <Input
                id="org-tax"
                value={form.taxId}
                onChange={(event) => set('taxId')(event.target.value)}
                disabled={!canEdit}
              />
            </Field>

            <Field label="RC number" htmlFor="org-rc">
              <Input
                id="org-rc"
                value={form.rcNumber}
                onChange={(event) => set('rcNumber')(event.target.value)}
                disabled={!canEdit}
              />
            </Field>
          </div>

          <Field
            label="Logo URL"
            htmlFor="org-logo"
            hint="A link to an image. Printed at the top of a document."
          >
            <Input
              id="org-logo"
              value={form.logoUrl}
              onChange={(event) => set('logoUrl')(event.target.value)}
              disabled={!canEdit}
            />
          </Field>
        </section>

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Fixed for this business
          </h2>
          <div className="mt-3 flex flex-wrap gap-6 text-sm">
            <div>
              <div className="text-xs uppercase text-slate-500">Currency</div>
              <div className="text-slate-900">{data?.currency}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-slate-500">Timezone</div>
              <div className="text-slate-900">{data?.timezone}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-slate-500">Shop code</div>
              <div className="text-slate-900">{data?.slug}</div>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            These cannot be changed. Every report period resolves in the
            timezone, so moving it would restate months that are already
            closed, and invoice numbering cannot be rewound without producing
            two invoices with the same number. The shop code qualifies staff
            usernames.
          </p>
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
            Saved. New invoices and statements will carry these details.
          </p>
        )}

        {canEdit && (
          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={save.isPending || !form.name.trim()}
            >
              {save.isPending ? 'Saving…' : 'Save details'}
            </Button>
          </div>
        )}

        {!canEdit && (
          <p className="text-sm text-slate-500">
            Only an owner or a manager can change these. You can see them
            because they are what your invoices say.
          </p>
        )}
      </form>
    </Page>
  );
}
