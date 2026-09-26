import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Button } from '../components/Button';
import { Input } from '../components/Field';
import { api, ApiError } from '../api/client';
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
        />
        <SetupList
          title="Packaging types"
          hint="How goods are physically packed — sachet, pouch, carton."
          queryKey="packaging-types"
          path="/packaging-types"
          canEdit={isManager}
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
}: {
  title: string;
  hint: string;
  queryKey: string;
  path: string;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: rows = [], isPending } = useQuery({
    queryKey: [queryKey],
    queryFn: () => api.get<(CategoryView | PackagingTypeView)[]>(path),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post(path, { id: crypto.randomUUID(), name: name.trim() }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [queryKey] });
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
            <li key={row.id} className="text-slate-700">
              {row.name}
            </li>
          ))}
        </ul>
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
      void queryClient.invalidateQueries({ queryKey: ['price-tiers'] });
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
