import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Button } from '../components/Button';
import { Field, Input, Select } from '../components/Field';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import { useIsManager, useRecordsStock } from '../auth/useAuth';
import type { components } from '../api/schema';

type StocktakeView = components['schemas']['StocktakeView'];
type PostedStocktakeView = components['schemas']['PostedStocktakeView'];
type ProductView = components['schemas']['ProductView'];

/**
 * One count sheet.
 *
 * **Counted quantities are base units** — the same unit the ledger counts in
 * (DECISIONS.md §2). There is no unit picker here on purpose: somebody holding
 * a clipboard counts pieces on a shelf, and offering cartons would invite a
 * number that has to be multiplied before it means anything.
 *
 * While the count is **open** the variance is measured against *live* stock,
 * because that is what posting will compare — so it moves as the shop trades,
 * and that is correct rather than unstable. Once posted it reports the
 * snapshot, which is what was actually true when the correction was made.
 *
 * Posting writes ordinary `adjustment` movements with reason
 * `count_correction`: shortfalls leave FEFO, surpluses land on the newest lot
 * at that location, because every movement carries a batch (§5).
 */
export function CountSheetPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isManager = useIsManager();
  const recordsStock = useRecordsStock();

  const [productId, setProductId] = useState('');
  const [counted, setCounted] = useState('');
  const [lineNote, setLineNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState<number | null>(null);

  const { data: count, isPending } = useQuery({
    queryKey: ['stocktake', id],
    queryFn: () => api.get<StocktakeView>(`/stocktakes/${id}`),
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products', ''],
    queryFn: () => api.get<ProductView[]>('/products'),
  });

  const refresh = () => {
    afterWrite(queryClient);
  };

  const addLine = useMutation({
    mutationFn: () =>
      api.post<StocktakeView>(`/stocktakes/${id}/lines`, {
        lines: [
          {
            productId,
            countedQuantity: Number(counted),
            ...(lineNote.trim() ? { note: lineNote.trim() } : {}),
          },
        ],
      }),
    onSuccess: () => {
      refresh();
      setProductId('');
      setCounted('');
      setLineNote('');
      setError(null);
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not record that count.',
      ),
  });

  const removeLine = useMutation({
    mutationFn: (lineProductId: string) =>
      api.delete<StocktakeView>(`/stocktakes/${id}/lines/${lineProductId}`),
    onSuccess: refresh,
    onError: (caught) =>
      setError(
        caught instanceof ApiError ? caught.message : 'Could not remove that.',
      ),
  });

  const post = useMutation({
    mutationFn: () =>
      api.post<PostedStocktakeView>(`/stocktakes/${id}/post`, {}),
    onSuccess: (result) => {
      refresh();
      afterWrite(queryClient);
      setPosted(result.corrections);
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not post that count.',
      ),
  });

  const cancel = useMutation({
    mutationFn: () => api.post<StocktakeView>(`/stocktakes/${id}/cancel`, {}),
    onSuccess: () => {
      refresh();
      navigate('/stock/counts');
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not cancel that count.',
      ),
  });

  if (isPending || !count) {
    return (
      <Page title="Count">
        <p className="text-sm text-slate-500">Loading…</p>
      </Page>
    );
  }

  const open = count.status === 'open';
  const alreadyCounted = new Set(count.lines.map((line) => line.productId));
  const addable = products.filter(
    (product) => product.trackStock && !alreadyCounted.has(product.id),
  );

  const submitLine = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (productId && counted !== '') addLine.mutate();
  };

  return (
    <Page
      title={`Count at ${count.location.name}`}
      description={
        open
          ? 'Nothing here has touched stock. Posting is what writes the corrections.'
          : `${count.status === 'posted' ? 'Posted' : 'Cancelled'} — this sheet is history now.`
      }
      actions={
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => navigate('/stock/counts')}>
            Back
          </Button>
          {open && isManager && (
            <>
              <Button
                variant="secondary"
                onClick={() => cancel.mutate()}
                disabled={cancel.isPending}
              >
                Abandon
              </Button>
              <Button
                onClick={() => post.mutate()}
                disabled={post.isPending || count.lines.length === 0}
              >
                {post.isPending ? 'Posting…' : 'Post the count'}
              </Button>
            </>
          )}
        </div>
      }
    >
      {posted !== null && (
        <p className="mb-4 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
          Posted. {posted === 0
            ? 'Every line matched, so nothing moved.'
            : `${posted} line${posted === 1 ? '' : 's'} wrote a correction to the ledger.`}
        </p>
      )}

      {open && !isManager && (
        <p className="mb-4 rounded-md bg-slate-100 p-3 text-sm text-slate-600">
          Record what you counted here. An owner or manager posts it — finding a
          shortfall and approving it are deliberately different jobs.
        </p>
      )}

      <div className="mb-4 grid gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-3">
        <div>
          <div className="text-xs uppercase text-slate-500">Counted</div>
          <div className="text-xl font-semibold text-slate-900">
            {count.counted}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase text-slate-500">Disagreements</div>
          <div className="text-xl font-semibold text-slate-900">
            {count.discrepancies}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase text-slate-500">Net variance</div>
          <div
            className={`text-xl font-semibold tabular-nums ${
              count.netVariance === 0
                ? 'text-slate-900'
                : count.netVariance < 0
                  ? 'text-red-600'
                  : 'text-emerald-700'
            }`}
          >
            {count.netVariance > 0 ? `+${count.netVariance}` : count.netVariance}
          </div>
        </div>
      </div>

      {open && recordsStock && (
        <form
          onSubmit={submitLine}
          className="mb-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-12"
        >
          <div className="sm:col-span-5">
            <Field label="Product" htmlFor="count-product">
              <Select
                id="count-product"
                value={productId}
                onChange={(event) => setProductId(event.target.value)}
              >
                <option value="">Choose a product</option>
                {addable.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="sm:col-span-2">
            <Field
              label="On the shelf"
              htmlFor="count-quantity"
              hint="Base units."
            >
              <Input
                id="count-quantity"
                inputMode="numeric"
                value={counted}
                onChange={(event) =>
                  setCounted(event.target.value.replace(/[^\d]/g, ''))
                }
                placeholder="0"
              />
            </Field>
          </div>

          <div className="sm:col-span-3">
            <Field label="Note" htmlFor="count-line-note">
              <Input
                id="count-line-note"
                value={lineNote}
                onChange={(event) => setLineNote(event.target.value)}
                placeholder="Two tins dented, left on the shelf."
              />
            </Field>
          </div>

          <div className="flex items-end sm:col-span-2">
            <Button
              type="submit"
              disabled={addLine.isPending || !productId || counted === ''}
              className="w-full"
            >
              {addLine.isPending ? 'Saving…' : 'Record'}
            </Button>
          </div>
        </form>
      )}

      {error && (
        <p
          className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700"
          role="alert"
        >
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-slate-600">
                Product
              </th>
              <th className="px-4 py-3 text-right font-medium text-slate-600">
                Ledger says
              </th>
              <th className="px-4 py-3 text-right font-medium text-slate-600">
                Counted
              </th>
              <th className="px-4 py-3 text-right font-medium text-slate-600">
                Variance
              </th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">
                Note
              </th>
              {open && recordsStock && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {count.lines.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  Nothing counted yet.
                </td>
              </tr>
            )}
            {count.lines.map((line) => (
              <tr key={line.id}>
                <td className="px-4 py-3">
                  <span className="block text-slate-900">
                    {line.product.name}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {line.product.sku}
                  </span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                  {line.expectedQuantity}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-900">
                  {line.countedQuantity}
                </td>
                <td
                  className={`px-4 py-3 text-right tabular-nums ${
                    line.variance === 0
                      ? 'text-slate-400'
                      : line.variance < 0
                        ? 'text-red-600'
                        : 'text-emerald-700'
                  }`}
                >
                  {line.variance > 0 ? `+${line.variance}` : line.variance}
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {line.note ?? ''}
                </td>
                {open && recordsStock && (
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      onClick={() => removeLine.mutate(line.productId)}
                      disabled={removeLine.isPending}
                    >
                      Remove
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <p className="mt-4 text-xs text-slate-500">
          Counting the same product twice replaces the earlier line — a recount
          is a correction, not a second opinion. The variance is measured
          against live stock and is recomputed again at the moment of posting,
          so goods that move in between are accounted for.
        </p>
      )}
    </Page>
  );
}
