import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Button } from '../components/Button';
import { Field, Input } from '../components/Field';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import { useIsManager } from '../auth/useAuth';
import type { components } from '../api/schema';

type LocationView = components['schemas']['LocationView'];
type SupplierView = components['schemas']['SupplierView'];

/**
 * Where stock sits, and who it comes from.
 *
 * Both are soft-deleted rather than removed, for the same reason and with one
 * difference:
 *
 * - **A location cannot be retired while it still holds stock.** Movements
 *   point at it forever — the ledger is append-only — so retiring one would
 *   strand whatever is there where nothing can see it. Move the stock first.
 * - **A vendor can always be retired**, because past deliveries keep pointing
 *   at the row and still say who they came from.
 *
 * Re-adding something by a name that was used before **restores the old row**
 * rather than failing, which is what somebody who typed "Van 2" twice actually
 * meant.
 */
export function PlacesPage() {
  const isManager = useIsManager();

  return (
    <Page
      title="Places & vendors"
      description="Where stock sits, and who it comes from."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <Locations canEdit={isManager} />
        <Suppliers canEdit={isManager} />
      </div>
    </Page>
  );
}

function Locations({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: locations = [], isPending } = useQuery({
    queryKey: ['locations'],
    queryFn: () => api.get<LocationView[]>('/locations'),
  });

  const makeDefault = useMutation({
    mutationFn: (id: string) =>
      api.patch<LocationView>(`/locations/${id}`, { isDefault: true }),
    onSuccess: () => {
      afterWrite(queryClient);
      setError(null);
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError ? caught.message : 'Could not change that.',
      ),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/locations/${id}`),
    onSuccess: () => {
      afterWrite(queryClient);
      setError(null);
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not remove that location.',
      ),
  });

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">Locations</h2>
        {canEdit && (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            Add a location
          </Button>
        )}
      </header>

      {error && (
        <p className="m-4 rounded-md bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      {isPending && <p className="p-4 text-sm text-slate-500">Loading…</p>}

      <ul className="divide-y divide-slate-100">
        {locations.map((location) => (
          <li
            key={location.id}
            className="flex items-center justify-between gap-4 px-4 py-3"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-900">
                  {location.name}
                </span>
                {location.isDefault && (
                  <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs text-white">
                    default
                  </span>
                )}
              </div>
              {location.description && (
                <p className="mt-0.5 text-xs text-slate-500">
                  {location.description}
                </p>
              )}
            </div>

            {canEdit && (
              <div className="flex gap-1">
                {!location.isDefault && (
                  <>
                    <Button
                      variant="ghost"
                      onClick={() => makeDefault.mutate(location.id)}
                      disabled={makeDefault.isPending}
                    >
                      Make default
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => remove.mutate(location.id)}
                      disabled={remove.isPending}
                    >
                      Remove
                    </Button>
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
        A location holding stock cannot be removed — move what is there first.
        The default one cannot be removed at all.
      </p>

      {adding && <LocationDialog onClose={() => setAdding(false)} />}
    </section>
  );
}

function LocationDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.post<LocationView>('/locations', {
        id: crypto.randomUUID(),
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
      }),
    onSuccess: () => {
      afterWrite(queryClient);
      onClose();
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not save that location.',
      ),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (name.trim()) create.mutate();
  };

  return (
    <Dialog
      title="Add a location"
      labelledBy="location-title"
      onClose={onClose}
      onSubmit={submit}
      busy={create.isPending}
      ready={Boolean(name.trim())}
      error={error}
      confirm="Add location"
    >
      <Field label="Name" htmlFor="location-name">
        <Input
          id="location-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Van 2"
          autoFocus
          required
        />
      </Field>

      <Field label="Description" htmlFor="location-description">
        <Input
          id="location-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Tuesday round"
        />
      </Field>
    </Dialog>
  );
}

function Suppliers({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: suppliers = [], isPending } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api.get<SupplierView[]>('/suppliers'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/suppliers/${id}`),
    onSuccess: () => {
      afterWrite(queryClient);
      setError(null);
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not remove that vendor.',
      ),
  });

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">Vendors</h2>
        {canEdit && (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            Add a vendor
          </Button>
        )}
      </header>

      {error && (
        <p className="m-4 rounded-md bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      {isPending && <p className="p-4 text-sm text-slate-500">Loading…</p>}

      {!isPending && suppliers.length === 0 && (
        <p className="p-4 text-sm text-slate-500">
          No vendors yet. A delivery has to come from one.
        </p>
      )}

      <ul className="divide-y divide-slate-100">
        {suppliers.map((supplier) => (
          <li
            key={supplier.id}
            className="flex items-center justify-between gap-4 px-4 py-3"
          >
            <div>
              <span className="text-sm font-medium text-slate-900">
                {supplier.name}
              </span>
              <p className="mt-0.5 text-xs text-slate-500">
                {supplier.phone ?? 'no phone'}
                {supplier.address ? ` · ${supplier.address}` : ''}
              </p>
            </div>

            {canEdit && (
              <Button
                variant="ghost"
                onClick={() => remove.mutate(supplier.id)}
                disabled={remove.isPending}
              >
                Remove
              </Button>
            )}
          </li>
        ))}
      </ul>

      <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
        Removing a vendor hides them from the pickers. Past deliveries still say
        who they came from.
      </p>

      {adding && <SupplierDialog onClose={() => setAdding(false)} />}
    </section>
  );
}

function SupplierDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.post<SupplierView>('/suppliers', {
        id: crypto.randomUUID(),
        name: name.trim(),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(address.trim() ? { address: address.trim() } : {}),
      }),
    onSuccess: () => {
      afterWrite(queryClient);
      onClose();
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not save that vendor.',
      ),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (name.trim()) create.mutate();
  };

  return (
    <Dialog
      title="Add a vendor"
      labelledBy="supplier-title"
      onClose={onClose}
      onSubmit={submit}
      busy={create.isPending}
      ready={Boolean(name.trim())}
      error={error}
      confirm="Add vendor"
    >
      <Field label="Name" htmlFor="supplier-name">
        <Input
          id="supplier-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Dangote Distribution"
          autoFocus
          required
        />
      </Field>

      <Field
        label="Phone"
        htmlFor="supplier-phone"
        hint="Chasing a delivery is a phone call."
      >
        <Input
          id="supplier-phone"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="0803 000 0000"
        />
      </Field>

      <Field label="Address" htmlFor="supplier-address">
        <Input
          id="supplier-address"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
        />
      </Field>
    </Dialog>
  );
}

/** The modal shell both of the above share. */
function Dialog({
  title,
  labelledBy,
  onClose,
  onSubmit,
  busy,
  ready,
  error,
  confirm,
  children,
}: {
  title: string;
  labelledBy: string;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  busy: boolean;
  ready: boolean;
  error: string | null;
  confirm: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-lg"
      >
        <h2 id={labelledBy} className="text-lg font-semibold text-slate-900">
          {title}
        </h2>

        <div className="mt-4 space-y-4">{children}</div>

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
            disabled={busy}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !ready}>
            {busy ? 'Saving…' : confirm}
          </Button>
        </div>
      </form>
    </div>
  );
}
