import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Money } from '../components/Money';
import { api } from '../api/client';
import { useSeesCost } from '../auth/useAuth';
import type { components } from '../api/schema';

type ExpiringBatchRow = components['schemas']['ExpiringBatchRow'];

/** How many lots to show before asking whether somebody wants the rest. */
const PREVIEW = 5;

function daysUntil(date: string): number {
  const ms = new Date(date).getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}

/**
 * Lots going off soon, soonest first.
 *
 * This is the list somebody walks the shelves with, so it stays open to every
 * role: knowing which lots to push is not a cost question. The **value at
 * risk** is a buying price and is absent for a role that may not see it, which
 * is why it goes through `<Money>` (DECISIONS.md §9).
 *
 * Sits above stock on hand rather than on a tab of its own because it is a
 * prompt, not a report — it wants to be seen without being looked for, and it
 * is usually empty.
 */
export function ExpiryPanel({ locationId }: { locationId: string }) {
  const [showAll, setShowAll] = useState(false);

  const query = new URLSearchParams();
  if (locationId) query.set('locationId', locationId);

  const { data: batches = [] } = useQuery({
    queryKey: ['expiring-batches', query.toString()],
    // No `expiringBefore`, so the server's own window applies: 30 days.
    queryFn: () => api.get<ExpiringBatchRow[]>(`/stock/batches?${query}`),
  });

  const seesCost = useSeesCost();
  if (batches.length === 0) return null;

  const shown = showAll ? batches : batches.slice(0, PREVIEW);
  const atRisk = batches.reduce(
    (total, batch) => total + (batch.valueAtRisk ?? 0),
    0,
  );

  return (
    <section className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-semibold text-amber-900">
          Going off within 30 days
        </h2>
        {seesCost && (
          <span className="text-sm text-amber-900">
            <Money value={atRisk} /> at risk
          </span>
        )}
      </div>

      <ul className="mt-3 space-y-1.5">
        {shown.map((batch) => {
          const days = batch.expiryDate ? daysUntil(batch.expiryDate) : null;
          return (
            <li
              key={batch.batchId}
              className="flex items-center gap-3 text-sm text-amber-900"
            >
              <span className="flex-1">
                {batch.product.name}
                <span className="text-amber-700">
                  {' '}
                  · {batch.location.name}
                  {batch.lotCode ? ` · ${batch.lotCode}` : ''}
                </span>
              </span>
              <span className="tabular-nums">{batch.quantity}</span>
              <span className="w-28 text-right tabular-nums">
                {days === null
                  ? '—'
                  : days < 0
                    ? `${Math.abs(days)}d ago`
                    : days === 0
                      ? 'today'
                      : `in ${days}d`}
              </span>
            </li>
          );
        })}
      </ul>

      {batches.length > PREVIEW && (
        <button
          type="button"
          onClick={() => setShowAll(!showAll)}
          className="mt-3 text-xs font-medium text-amber-900 underline"
        >
          {showAll
            ? 'Show fewer'
            : `Show all ${batches.length} lots`}
        </button>
      )}
    </section>
  );
}
