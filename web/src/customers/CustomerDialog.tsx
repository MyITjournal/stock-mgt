import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DialogClose } from '../components/DialogClose';
import { Button } from '../components/Button';
import { Field, Input, Select } from '../components/Field';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import type { components } from '../api/schema';

type CustomerView = components['schemas']['CustomerView'];
type PriceTierView = components['schemas']['PriceTierView'];

/**
 * Adding a customer, mid-transaction, with a queue waiting.
 *
 * Only `firstName` is required, and that is the market rather than laziness: a
 * customer here is often a shop known by one name and a phone number. Demanding
 * a surname or an address means the row never gets created and the debt is
 * never tracked.
 *
 * Opened from the Customers list and from the till. At the till it is `brief`
 * — a name and a phone number, nothing else, with somebody standing at the
 * counter. No price list: shops here price the item, not the buyer — the
 * wholesale price is the carton's or the 1/5 carton's own price — so asking
 * what kind of customer this is has no place at a busy counter. `onCreated`
 * hands the new row back so the sale is put in their name without picking
 * them from the list afterwards.
 *
 * **It looks for the customer first** (2026-10-07): the owner found the same
 * shop entered twice, invoices under each. As a name or phone is typed, up to
 * five existing customers that match are offered — at the till, tapping one
 * puts the sale in their name; on the Customers screen it opens them. A phone
 * already on file is said plainly and the button becomes *Add anyway*: two
 * people may share a name, so this warns and never refuses.
 */
export function CustomerDialog({
  onClose,
  onCreated,
  brief = false,
  onPickExisting,
  pickLabel = 'Open',
}: {
  onClose: () => void;
  onCreated?: (customer: CustomerView) => void;
  /** Name and phone only — the till's version. */
  brief?: boolean;
  /**
   * An existing customer was picked from the suggestions instead of adding
   * one. The till uses them for the sale; the Customers screen opens them.
   */
  onPickExisting: (customer: CustomerView) => void;
  /** What picking a suggestion does, in the button's words. */
  pickLabel?: string;
}) {
  const queryClient = useQueryClient();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [priceTierId, setPriceTierId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: tiers = [] } = useQuery({
    queryKey: ['price-tiers'],
    queryFn: () => api.get<PriceTierView[]>('/price-tiers'),
  });

  // Everyone already on file — the list the till and Customers screen hold.
  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => api.get<CustomerView[]>('/customers'),
  });
  const nameOf = (customer: CustomerView) =>
    [customer.firstName, customer.lastName].filter(Boolean).join(' ');
  const digits = (text: string | null | undefined) =>
    (text ?? '').replace(/\D/g, '').slice(-10);
  const typedName = `${firstName} ${lastName}`.trim().toLowerCase();
  const typedPhone = digits(phone);
  // The same phone is the strongest sign it is somebody already here; the
  // last ten digits, so +234 and 0 prefixes match.
  const phoneOwner =
    typedPhone.length >= 7
      ? customers.find((customer) => digits(customer.phone) === typedPhone)
      : undefined;
  const words = typedName.split(/\s+/).filter(Boolean);
  const nameMatches =
    typedName.length >= 2
      ? customers.filter((customer) => {
          const name = nameOf(customer).toLowerCase();
          return words.every((word) => name.includes(word));
        })
      : [];
  const suggestions = [
    ...(phoneOwner ? [phoneOwner] : []),
    ...nameMatches.filter((customer) => customer.id !== phoneOwner?.id),
  ].slice(0, 5);

  const create = useMutation({
    mutationFn: () =>
      api.post<CustomerView>('/customers', {
        id: crypto.randomUUID(),
        firstName: firstName.trim(),
        ...(lastName.trim() && { lastName: lastName.trim() }),
        ...(phone.trim() && { phone: phone.trim() }),
        ...(email.trim() && { email: email.trim() }),
        ...(priceTierId && { priceTierId }),
      }),
    onSuccess: (created) => {
      afterWrite(queryClient);
      onCreated?.(created);
      onClose();
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not save that customer.',
      ),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (firstName.trim()) create.mutate();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="customer-title"
    >
      <form
        onSubmit={submit}
        className="relative w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-lg"
      >
        <DialogClose onClose={onClose} />

        <h2
          id="customer-title"
          className="text-lg font-semibold text-slate-900"
        >
          {brief ? 'New customer' : 'Add a customer'}
        </h2>

        <div className="mt-4 space-y-4">
          <Field label="Name" htmlFor="new-customer-name">
            <Input
              id="new-customer-name"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              autoFocus
              required
            />
          </Field>

          {!brief && (
            <Field
              label="Surname"
              htmlFor="new-customer-surname"
              hint="Optional — plenty of customers are known by one name."
            >
              <Input
                id="new-customer-surname"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
              />
            </Field>
          )}

          <Field
            label="Phone"
            htmlFor="new-customer-phone"
            hint="Worth having: chasing a debt is a phone call."
          >
            <Input
              id="new-customer-phone"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+234…"
            />
          </Field>

          {suggestions.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-medium text-amber-900">
                {phoneOwner
                  ? `${phone.trim()} is already ${nameOf(phoneOwner)}'s number.`
                  : 'Already a customer?'}
              </p>
              <ul className="mt-2 space-y-1">
                {suggestions.map((customer) => (
                  <li
                    key={customer.id}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span>
                      <span className="text-slate-900">{nameOf(customer)}</span>
                      {customer.phone && (
                        <span className="ml-2 text-xs text-slate-500">
                          {customer.phone}
                        </span>
                      )}
                    </span>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        onPickExisting(customer);
                        onClose();
                      }}
                    >
                      {pickLabel}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!brief && (
            <Field label="Email" htmlFor="new-customer-email">
              <Input
                id="new-customer-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
          )}

          {!brief && (
            <Field
              label="Price list"
              htmlFor="new-customer-tier"
              hint="What they are charged. Blank uses the default."
            >
              <Select
                id="new-customer-tier"
                value={priceTierId}
                onChange={(event) => setPriceTierId(event.target.value)}
              >
                <option value="">Default</option>
                {tiers.map((tier) => (
                  <option key={tier.id} value={tier.id}>
                    {tier.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>

        {error && (
          <p
            className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700"
            role="alert"
          >
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={create.isPending}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={create.isPending || !firstName.trim()}
          >
            {create.isPending
              ? 'Saving…'
              : phoneOwner
                ? 'Add anyway'
                : brief
                  ? 'Add and use for this sale'
                  : 'Add customer'}
          </Button>
        </div>
      </form>
    </div>
  );
}
