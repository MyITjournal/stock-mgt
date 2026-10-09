import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Button } from '../components/Button';
import { Field, Input, Select } from '../components/Field';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import { useIsManager } from '../auth/useAuth';
import type { components } from '../api/schema';
import { BusinessTypeChoice } from '../components/BusinessTypeChoice';
import { businessTypeLabel, type BusinessType } from '../lib/businessTypes';
import { CURRENCY_CHOICES, TIMEZONE_CHOICES } from '../lib/shopCurrency';

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
 * **Currency and time zone can be put right only until money is recorded**
 * (§2, 2026-10-06). Every amount is a bare number of the shop's currency, so
 * once a price, sale, delivery, payment or expense exists, changing it would
 * relabel all of them — the server says so with `currencyLocked` and refuses
 * the change with a 409, and this screen shows them read-only from then on.
 * Invoice numbering is never editable: rewinding it would duplicate numbers.
 *
 * **The kind of shop is editable, and changes defaults only.** It decides how a
 * *new* product's units start out; nothing already set up moves, and no price
 * list is added or removed. The screen says so, because "I changed it and my
 * products did not change" is otherwise the first support question.
 *
 * **VAT is one switch.** Off, every sale from then on records no VAT, the
 * invoice prints no VAT line and reports count the whole price as the shop's.
 * Sales already made keep the VAT they were recorded with — the screen says
 * so, because switching it is meant to be safe to try while the owner checks
 * with an accountant.
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
  const [businessType, setBusinessType] = useState<BusinessType>(
    data.businessType,
  );
  const [chargesVat, setChargesVat] = useState(data.chargesVat);
  // The typed string, so the box never rewrites what is being typed.
  const [lowStockDays, setLowStockDays] = useState(String(data.lowStockDays));
  const warnDays = Number(lowStockDays);
  const warnDaysValid =
    lowStockDays !== '' &&
    Number.isInteger(warnDays) &&
    warnDays >= 1 &&
    warnDays <= 90;
  const [currency, setCurrency] = useState(data.currency);
  const [timezone, setTimezone] = useState(data.timezone);
  // The shop's own zone stays on the list even when it is not a usual one.
  const timezones = TIMEZONE_CHOICES.includes(
    data.timezone as (typeof TIMEZONE_CHOICES)[number],
  )
    ? [...TIMEZONE_CHOICES]
    : [data.timezone, ...TIMEZONE_CHOICES];
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
        businessType,
        chargesVat,
        ...(warnDaysValid && { lowStockDays: warnDays }),
        // Only while the server would accept them; once locked they are not
        // sent at all, so saving the letterhead can never trip the 409.
        ...(!data.currencyLocked && {
          currency: currency as (typeof CURRENCY_CHOICES)[number]['code'],
          timezone,
        }),
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

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">
            How you trade
          </h2>
          {canEdit ? (
            <div className="mt-3">
              <BusinessTypeChoice
                value={businessType}
                onChange={(next) => {
                  setBusinessType(next);
                  setSaved(false);
                }}
              />
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-900">
              {businessTypeLabel(businessType)}
            </p>
          )}
          <p className="mt-2 text-xs text-slate-500">
            This sets how new products start out. Products you have already set
            up, and your price lists, stay exactly as they are. Every feature is
            open whichever you choose.
          </p>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <Field label="Do you charge VAT?" htmlFor="org-vat">
            <Select
              id="org-vat"
              value={chargesVat ? 'yes' : 'no'}
              onChange={(event) => {
                setChargesVat(event.target.value === 'yes');
                setSaved(false);
              }}
              disabled={!canEdit}
            >
              <option value="no">No</option>
              <option value="yes">
                {currency === 'NGN'
                  ? 'Yes — my prices include 7.5% VAT'
                  : 'Yes — my prices include VAT'}
              </option>
            </Select>
          </Field>
          <p className="mt-2 text-xs text-slate-500">
            {chargesVat
              ? 'Each sale records the VAT inside its price, and the invoice shows it as “of which VAT”. A product marked Exempt carries none.'
              : 'Sales record no VAT, the invoice shows no VAT line, and reports count the whole price as yours.'}{' '}
            Changing this affects sales from now on — sales already made keep
            what they recorded.
          </p>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <Field
            label="Warn me when stock won’t last"
            htmlFor="org-low-days"
            hint="Days, at the rate each item has been selling. 1 to 90."
          >
            <div className="flex items-center gap-2">
              <Input
                id="org-low-days"
                inputMode="numeric"
                value={lowStockDays}
                onChange={(event) => {
                  setLowStockDays(event.target.value.replace(/[^d]/g, ''));
                  setSaved(false);
                }}
                className="w-20"
                disabled={!canEdit}
              />
              <span className="text-sm text-slate-700">days</span>
            </div>
          </Field>
          {!warnDaysValid && (
            <p className="mt-2 text-xs text-red-600">
              Between 1 and 90 days. This one is not saved until it is.
            </p>
          )}
          <p className="mt-2 text-xs text-slate-500">
            An item is <em>running low</em> once what is on hand will not last
            this long at the rate it sold over the last 30 days. Set it to about
            how long a delivery takes to arrive. It shows on Home and in Reports
            → Stock.
          </p>
        </section>

        {!data.currencyLocked && (
          <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap gap-4">
              <Field label="Currency" htmlFor="org-currency">
                <Select
                  id="org-currency"
                  value={currency}
                  onChange={(event) => {
                    setCurrency(event.target.value);
                    setSaved(false);
                  }}
                  disabled={!canEdit}
                >
                  {CURRENCY_CHOICES.map((choice) => (
                    <option key={choice.code} value={choice.code}>
                      {choice.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Time zone" htmlFor="org-timezone">
                <Select
                  id="org-timezone"
                  value={timezone}
                  onChange={(event) => {
                    setTimezone(event.target.value);
                    setSaved(false);
                  }}
                  disabled={!canEdit}
                >
                  {timezones.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone.replace('_', ' ')}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <p className="text-xs text-amber-800">
              You can change these until you enter your first price or record
              your first sale, delivery, payment or expense. After that they
              stay as they are, because every amount already entered would
              change its meaning.
            </p>
          </section>
        )}

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Fixed for this business
          </h2>
          <div className="mt-3 flex flex-wrap gap-6 text-sm">
            {data.currencyLocked && (
              <>
                <div>
                  <div className="text-xs uppercase text-slate-500">
                    Currency
                  </div>
                  <div className="text-slate-900">{data.currency}</div>
                </div>
                <div>
                  <div className="text-xs uppercase text-slate-500">
                    Time zone
                  </div>
                  <div className="text-slate-900">{data.timezone}</div>
                </div>
              </>
            )}
            <div>
              <div className="text-xs uppercase text-slate-500">Shop code</div>
              <div className="text-slate-900">{data.slug}</div>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            {data.currencyLocked &&
              'The currency and time zone are fixed now that amounts have been recorded in them — changing them would change the meaning of every figure already entered. '}
            The shop code qualifies staff usernames. Invoice numbering cannot be
            rewound without producing two invoices with the same number.
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
