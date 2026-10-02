import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Button } from '../components/Button';
import { Input } from '../components/Field';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import { useIsManager } from '../auth/useAuth';
import type { components } from '../api/schema';

type CategoryView = components['schemas']['CategoryView'];
type PackagingTypeView = components['schemas']['PackagingTypeView'];
type PriceTierView = components['schemas']['PriceTierView'];

/**
 * The vocabulary a catalog is described in: categories, packaging types and
 * price tiers.
 *
 * All three are **tables rather than enums**, and seeded at registration, so a
 * business can use its own words — "sachet" and "dispenser" mean something
 * specific in this market and nothing in a fixed list. Editing them is
 * owner-and-manager work, which is why this sits behind a role check that the
 * server also enforces.
 *
 * Price tiers are the one with teeth: a tier is what decides the price on a
 * sale, so adding one is adding a price list somebody has to fill in per unit.
 * An empty tier is not neutral — a unit with no price for that tier falls back
 * to base price × factor (§4).
 */
export function CatalogSetupPage() {
  const isManager = useIsManager();

  return (
    <Page
      title="Categories & tiers"
      description="The words this catalog is described in."
    >
      <div className="grid gap-6 lg:grid-cols-3">
        <SetupList
          title="Categories"
          hint="How products are grouped for reports and filtering."
          queryKey="categories"
          path="/categories"
          canEdit={isManager}
          removeNote="A category with products in it cannot be removed — move them to another category first."
        />
        <SetupList
          title="Packaging types"
          hint="How goods are physically packed — sachet, pouch, carton."
          queryKey="packaging-types"
          path="/packaging-types"
          canEdit={isManager}
          removeNote="Removing one takes it off the list for new products. Products already packed that way keep it."
        />
        <TierList canEdit={isManager} />
      </div>
    </Page>
  );
}

function SetupList({
  title,
  hint,
  queryKey,
  path,
  canEdit,
  removeNote,
}: {
  title: string;
  hint: string;
  queryKey: string;
  path: string;
  canEdit: boolean;
  removeNote: string;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  // The row awaiting a yes. The button sits beside the name, so one stray
  // click should not be enough.
  const [confirming, setConfirming] = useState<string | null>(null);

  const { data: rows = [], isPending } = useQuery({
    queryKey: [queryKey],
    queryFn: () => api.get<(CategoryView | PackagingTypeView)[]>(path),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post(path, { id: crypto.randomUUID(), name: name.trim() }),
    onSuccess: () => {
      afterWrite(queryClient);
      setName('');
      setError(null);
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError ? caught.message : 'Could not add that.',
      ),
  });

  // A 409 here is a rule, not a fault: the server names what is still in the
  // way, and that message is what the person needs to read.
  const remove = useMutation({
    mutationFn: (id: string) => api.delete<void>(`${path}/${id}`),
    onSuccess: () => {
      afterWrite(queryClient);
      setError(null);
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError ? caught.message : 'Could not remove that.',
      ),
    onSettled: () => setConfirming(null),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) create.mutate();
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>

      {isPending ? (
        <p className="mt-3 text-sm text-slate-500">Loading…</p>
      ) : (
        <ul className="mt-3 space-y-1 text-sm">
          {rows.length === 0 && (
            <li className="text-slate-400">None yet.</li>
          )}
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex min-h-8 items-center justify-between gap-2 text-slate-700"
            >
              {confirming === row.id ? (
                <>
                  <span>Remove {row.name}?</span>
                  <span className="flex gap-1">
                    <Button
                      variant="danger"
                      onClick={() => remove.mutate(row.id)}
                      disabled={remove.isPending}
                    >
                      Remove
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setConfirming(null)}
                      disabled={remove.isPending}
                    >
                      Keep
                    </Button>
                  </span>
                </>
              ) : (
                <>
                  <span>{row.name}</span>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setError(null);
                        setConfirming(row.id);
                      }}
                      aria-label={`Remove ${row.name}`}
                    >
                      Remove
                    </Button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && rows.length > 0 && (
        <p className="mt-2 text-xs text-slate-500">{removeNote}</p>
      )}

      {canEdit && (
        <form onSubmit={submit} className="mt-4 flex gap-2">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={`New ${title.toLowerCase().replace(/s$/, '')}`}
            aria-label={`New ${title}`}
          />
          <Button type="submit" disabled={create.isPending || !name.trim()}>
            Add
          </Button>
        </form>
      )}

      {error && (
        <p className="mt-2 text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function TierList({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: tiers = [] } = useQuery({
    queryKey: ['price-tiers'],
    queryFn: () => api.get<PriceTierView[]>('/price-tiers'),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post('/price-tiers', {
        id: crypto.randomUUID(),
        name: name.trim(),
      }),
    onSuccess: () => {
      afterWrite(queryClient);
      setName('');
      setError(null);
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError ? caught.message : 'Could not add that.',
      ),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) create.mutate();
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Price tiers</h2>
      <p className="mt-1 text-xs text-slate-500">
        Price lists a customer can be put on. One is the default, used for
        walk-ins and anyone with no tier set.
      </p>

      <ul className="mt-3 space-y-1 text-sm">
        {tiers.map((tier) => (
          <li key={tier.id} className="flex items-center gap-2 text-slate-700">
            {tier.name}
            {tier.isDefault && (
              <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs text-white">
                default
              </span>
            )}
          </li>
        ))}
      </ul>

      {canEdit && (
        <>
          <form onSubmit={submit} className="mt-4 flex gap-2">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="New tier"
              aria-label="New price tier"
            />
            <Button type="submit" disabled={create.isPending || !name.trim()}>
              Add
            </Button>
          </form>
          <p className="mt-2 text-xs text-amber-700">
            A new tier starts empty, and an empty tier is not neutral: until a
            unit is priced on it, that unit falls back to base price × factor.
          </p>
        </>
      )}

      {error && (
        <p className="mt-2 text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
