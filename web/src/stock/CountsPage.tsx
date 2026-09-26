import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { DataTable, type Column } from '../components/DataTable';
import { Button } from '../components/Button';
import { Field, Input, Select } from '../components/Field';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import { useRecordsStock } from '../auth/useAuth';
import type { components } from '../api/schema';

type StocktakeSummary = components['schemas']['StocktakeSummary'];
type LocationView = components['schemas']['LocationView'];

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800',
  posted: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-slate-200 text-slate-600',
};

/**
 * Physical counts.
 *
 * **Counting is not adjusting** (DECISIONS.md §5). A count is recorded by
 * whoever walks the aisles and **posted** by an owner or manager; until it is
 * posted it changes no stock at all. Finding a shortfall and approving it are
 * deliberately different jobs — somebody who could do both can walk out with
 * the difference.
 *
 * One open count per location at a time, because two would post variances
 * against each other's corrections.
 */
export function CountsPage() {
  const navigate = useNavigate();
  const recordsStock = useRecordsStock();
  const [status, setStatus] = useState('');
  const [starting, setStarting] = useState(false);

  const query = new URLSearchParams();
  if (status) query.set('status', status);

  const { data: counts = [], isPending } = useQuery({
    queryKey: ['stocktakes', query.toString()],
    queryFn: () => api.get<StocktakeSummary[]>(`/stocktakes?${query}`),
  });

  const columns: readonly Column<StocktakeSummary>[] = [
    {
      header: 'Started',
      cell: (row) => (
        <span className="whitespace-nowrap">
          {new Date(row.startedAt).toLocaleString()}
        </span>
      ),
    },
    {
      header: 'Where',
      cell: (row) => (
        <span className="font-medium text-slate-900">{row.location.name}</span>
      ),
    },
    {
      header: 'Status',
      cell: (row) => (
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${
            STATUS_STYLES[row.status] ?? 'bg-slate-100 text-slate-600'
          }`}
        >
          {row.status}
        </span>
      ),
    },
    {
      header: 'Counted by',
      cell: (row) =>
        row.startedBy
          ? `${row.startedBy.firstName ?? ''} ${row.startedBy.lastName ?? ''}`.trim() ||
            '—'
          : '—',
    },
    {
      header: 'Posted by',
      cell: (row) =>
        row.postedBy ? (
          `${row.postedBy.firstName ?? ''} ${row.postedBy.lastName ?? ''}`.trim() ||
          '—'
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    {
      header: 'Products',
      numeric: true,
      cell: (row) => row.lines.length,
    },
  ];

  return (
    <Page
      title="Counts"
      description="What is actually on the shelf. Nothing moves until a manager posts it."
      actions={
        recordsStock ? (
          <Button onClick={() => setStarting(true)}>Start a count</Button>
        ) : undefined
      }
    >
      <div className="mb-4 max-w-xs">
        <Field label="Status" htmlFor="count-status">
          <Select
            id="count-status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">All</option>
            <option value="open">Open</option>
            <option value="posted">Posted</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </Field>
      </div>

      <DataTable
        rows={counts}
        columns={columns}
        rowKey={(row) => row.id}
        loading={isPending}
        onRowClick={(row) => navigate(`/stock/counts/${row.id}`)}
        empty="No counts yet. Starting one changes nothing until it is posted."
      />

      {starting && <StartCountDialog onClose={() => setStarting(false)} />}
    </Page>
  );
}

function StartCountDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [locationId, setLocationId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: () => api.get<LocationView[]>('/locations'),
  });

  const start = useMutation({
    mutationFn: () =>
      api.post<StocktakeSummary>('/stocktakes', {
        id: crypto.randomUUID(),
        ...(locationId ? { locationId } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: (count) => {
      afterWrite(queryClient);
      navigate(`/stock/counts/${count.id}`);
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not open that count.',
      ),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    start.mutate();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="count-title"
    >
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-lg"
      >
        <h2 id="count-title" className="text-lg font-semibold text-slate-900">
          Start a count
        </h2>
        <p className="mt-2 text-sm text-slate-500">
          Counts are per location — counting everywhere at once is not something
          anybody does with a clipboard. Nothing you enter will touch stock
          until a manager posts it.
        </p>

        <div className="mt-4 space-y-4">
          <Field
            label="Where"
            htmlFor="count-location"
            hint="Defaults to the main store."
          >
            <Select
              id="count-location"
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
            >
              <option value="">Default location</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Note" htmlFor="count-note">
            <Input
              id="count-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Month-end count, main store."
            />
          </Field>
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
            disabled={start.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={start.isPending}>
            {start.isPending ? 'Opening…' : 'Start counting'}
          </Button>
        </div>
      </form>
    </div>
  );
}
