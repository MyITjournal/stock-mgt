import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../components/Button';
import { Input, Select } from '../components/Field';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import type { components } from '../api/schema';

type ProductView = components['schemas']['ProductView'];
type ProductBarcodeView = components['schemas']['ProductBarcodeView'];

/**
 * The codes on a product, and the one part of this form that writes
 * immediately.
 *
 * **Barcodes are a separate act from editing a product** (DECISIONS.md §4).
 * The `barcodes` array on `POST`/`PATCH /products` upserts what it lists and
 * leaves the rest alone — which is right for creating a product with its codes
 * — but attaching a code to a product that already exists has its own
 * endpoint, and so does removing one. So these buttons take effect when they
 * are pressed, rather than waiting for Save, and the section says so.
 *
 * **Barcodes are the one thing here that can be deleted.** Units cannot,
 * because movements and sale lines point at them; prices cannot, because an
 * unpriced unit falls back to `basePrice × factor` and silently overcharges
 * for a carton. A code is only a label on a shelf: detaching it strands
 * nothing, and a mis-scanned or reused code is an ordinary thing to want gone.
 * The form has said all of this since it was written — it just had no button
 * to do it with.
 *
 * Leaving the code blank generates an internal EAN-13, which is how goods
 * that arrive unbarcoded get one that can be printed and scanned.
 */
export function Barcodes({
  product,
  units,
}: {
  product: ProductView;
  units: { name: string; factor: number }[];
}) {
  const queryClient = useQueryClient();
  const [unitId, setUnitId] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Read rather than taken from the `product` prop: this list changes while
  // the dialog is open, and the prop is a snapshot of the row behind it.
  const { data: barcodes = [] } = useQuery({
    queryKey: ['product-barcodes', product.id],
    queryFn: () =>
      api.get<ProductBarcodeView[]>(`/products/${product.id}/barcodes`),
    initialData: product.barcodes,
  });

  const attach = useMutation({
    mutationFn: () =>
      api.post<ProductBarcodeView>(`/products/${product.id}/barcodes`, {
        id: crypto.randomUUID(),
        unitId: unitId || product.units[0]?.id,
        ...(code.trim() ? { code: code.trim() } : {}),
      }),
    onSuccess: () => {
      afterWrite(queryClient);
      setCode('');
      setAdding(false);
      setError(null);
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not attach that code.',
      ),
  });

  const detach = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/barcodes/${id}`),
    onSuccess: () => {
      afterWrite(queryClient);
      setError(null);
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not remove that code.',
      ),
  });

  return (
    <section className="mt-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Barcodes</h3>
        {!adding && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => setAdding(true)}
          >
            Add a code
          </Button>
        )}
      </div>

      {barcodes.length === 0 && !adding && (
        <p className="mt-2 text-sm text-slate-500">
          No codes on this product. Scanning it at the till will not find it.
        </p>
      )}

      <ul className="mt-2 space-y-1 text-sm">
        {barcodes.map((barcode) => (
          <li
            key={barcode.id}
            className="flex items-center justify-between gap-3 text-slate-600"
          >
            <span>
              <span className="tabular-nums">{barcode.code}</span>
              <span className="ml-2 text-xs text-slate-400">
                {barcode.unit.name} · {barcode.symbology}
                {barcode.isPrimary ? ' · printed on labels' : ''}
              </span>
            </span>
            <Button
              type="button"
              variant="ghost"
              disabled={detach.isPending}
              onClick={() => detach.mutate(barcode.id)}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>

      {adding && (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="sm:col-span-1">
              <span className="block text-xs font-medium text-slate-700">
                Which unit
              </span>
              <Select
                aria-label="Unit this code is on"
                value={unitId || (product.units[0]?.id ?? '')}
                onChange={(event) => setUnitId(event.target.value)}
                className="mt-1"
              >
                {product.units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                    {unit.factor === 1 ? '' : ` (${unit.factor})`}
                  </option>
                ))}
              </Select>
            </label>

            <label className="sm:col-span-2">
              <span className="block text-xs font-medium text-slate-700">
                Code
              </span>
              <Input
                aria-label="Barcode"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="Scan it, or leave blank to generate one"
                className="mt-1"
                autoFocus
              />
            </label>
          </div>

          <p className="mt-2 text-xs text-slate-500">
            Leave it blank and an internal EAN-13 is generated, for goods that
            arrive without a code. A GS1 code whose check digit does not match
            is refused.
          </p>

          <div className="mt-3 flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setAdding(false);
                setCode('');
                setError(null);
              }}
              disabled={attach.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => attach.mutate()}
              disabled={attach.isPending || units.length === 0}
            >
              {attach.isPending ? 'Attaching…' : 'Attach code'}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p
          className="mt-2 rounded-md bg-red-50 p-3 text-sm text-red-700"
          role="alert"
        >
          {error}
        </p>
      )}

      <p className="mt-2 text-xs text-slate-500">
        Adding and removing codes takes effect straight away, not when you
        press Save — each one is its own act on the server.
      </p>
    </section>
  );
}
