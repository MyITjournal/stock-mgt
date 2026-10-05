import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Button } from '../components/Button';
import { Money } from '../components/Money';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import type { components } from '../api/schema';
import {
  COLUMNS,
  downloadTemplate,
  readSpreadsheet,
  type ImportRow,
} from '../lib/spreadsheet';

type ImportReportView = components['schemas']['ImportReportView'];
type ImportRowView = components['schemas']['ImportRowView'];

/**
 * A whole catalog from one spreadsheet: template, upload, preview, save.
 *
 * ## Nothing is saved until the preview has been read
 *
 * Choosing a file sends it with `dryRun`, and the server answers with every
 * row and what it will do — add, skip because it is already there, or what
 * is wrong with it. Only then is there a button, and it is refused while any
 * row is in error: the save is all or nothing, so a file is never half
 * imported. The server runs the same checks for both, so the preview cannot
 * promise a row the save refuses.
 *
 * ## The file is kept, the answer is not
 *
 * The rows read from the file stay in memory so the save sends exactly what
 * was previewed. Choosing another file starts again.
 */
export function ImportProductsPage() {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [report, setReport] = useState<ImportReportView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyAttention, setOnlyAttention] = useState(true);

  const preview = useMutation({
    mutationFn: (next: ImportRow[]) =>
      api.post<ImportReportView>('/products/import', {
        rows: next,
        dryRun: true,
      }),
    onSuccess: setReport,
    onError: (caught) => setError(messageFor(caught)),
  });

  const save = useMutation({
    mutationFn: () => api.post<ImportReportView>('/products/import', { rows }),
    onSuccess: (saved) => {
      afterWrite(queryClient);
      setReport(saved);
    },
    onError: (caught) => setError(messageFor(caught)),
  });

  const choose = async (file: File | undefined) => {
    setError(null);
    setReport(null);
    setRows([]);
    setIgnored([]);
    if (!file) return;
    setFileName(file.name);
    try {
      const read = await readSpreadsheet(file);
      if (read.rows.length === 0) {
        setError('There are no products in that file under the column names.');
        return;
      }
      setRows(read.rows);
      setIgnored(read.ignored);
      preview.mutate(read.rows);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const startAgain = () => {
    setFileName(null);
    setRows([]);
    setIgnored([]);
    setReport(null);
    setError(null);
    if (input.current) input.current.value = '';
  };

  const busy = preview.isPending || save.isPending;
  const shown =
    report && onlyAttention && report.errors > 0
      ? report.rows.filter(
          (row) => row.status === 'error' || row.messages.length > 0,
        )
      : (report?.rows ?? []);

  return (
    <Page
      title="Import products"
      description="Your whole catalog from one spreadsheet. Nothing is saved until you have checked the preview."
      back={{ to: '/stock', label: 'Products' }}
    >
      <div className="max-w-5xl space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">
            1. Start from the template
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            One row per product. Overwrite the two example rows with your own.
            Save it as an <strong>Excel Workbook (.xlsx)</strong> — a .csv works
            too, but Excel rounds long barcodes in one.
          </p>
          <Button
            type="button"
            variant="secondary"
            className="mt-3"
            onClick={downloadTemplate}
          >
            Download the template
          </Button>

          <dl className="mt-4 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
            {COLUMNS.filter((column) => column.hint).map((column) => (
              <div key={column.field} className="flex gap-2">
                <dt className="w-32 shrink-0 font-medium text-slate-700">
                  {column.header}
                </dt>
                <dd className="text-slate-500">{column.hint}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-slate-500">
            "How many" is how many of the counted-in unit a bigger unit holds:
            10 sachets in a roll, 160 in a carton. A portion is a unit too — a
            "1/5 carton" holding 32. Prices go on your normal price list. What
            you paid and how many you have are not part of this: record a
            delivery for those.
          </p>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">
            2. Upload your file
          </h2>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input
              ref={input}
              type="file"
              accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={busy}
              onChange={(event) => void choose(event.target.files?.[0])}
              className="text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-800 hover:file:bg-slate-200"
            />
            {preview.isPending && (
              <span className="text-sm text-slate-500">
                Checking {rows.length} rows…
              </span>
            )}
          </div>
          {ignored.length > 0 && (
            <p className="mt-2 text-xs text-slate-500">
              Columns not used: {ignored.join(', ')}.
            </p>
          )}
        </section>

        {error && (
          <p
            className="rounded-md bg-red-50 p-3 text-sm text-red-700"
            role="alert"
          >
            {error}
          </p>
        )}

        {report && (
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            {report.saved ? (
              <div className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">
                <p className="font-medium">
                  {report.adding === 0
                    ? 'Nothing new to add — every product in the file is already there.'
                    : `${report.adding} ${report.adding === 1 ? 'product' : 'products'} added.`}
                </p>
                <p className="mt-1">
                  <Link to="/stock" className="underline">
                    Go to products
                  </Link>{' '}
                  ·{' '}
                  <button
                    type="button"
                    className="underline"
                    onClick={startAgain}
                  >
                    Import another file
                  </button>
                </p>
              </div>
            ) : (
              <>
                <h2 className="text-sm font-semibold text-slate-900">
                  3. Check, then add
                </h2>
                <p className="mt-1 text-sm text-slate-700">
                  From <span className="font-medium">{fileName}</span>:{' '}
                  <span className="text-emerald-700">
                    {report.adding} to add
                  </span>
                  {report.skipped > 0 && (
                    <> · {report.skipped} already in your products</>
                  )}
                  {report.errors > 0 && (
                    <>
                      {' '}
                      ·{' '}
                      <span className="font-medium text-red-700">
                        {report.errors} to fix
                      </span>
                    </>
                  )}
                </p>
                {report.newCategories.length > 0 && (
                  <p className="mt-1 text-xs text-slate-500">
                    New categories: {report.newCategories.join(', ')}.
                  </p>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    onClick={() => save.mutate()}
                    disabled={busy || report.errors > 0 || report.adding === 0}
                  >
                    {save.isPending
                      ? 'Adding…'
                      : `Add ${report.adding} ${report.adding === 1 ? 'product' : 'products'}`}
                  </Button>
                  {report.errors > 0 && (
                    <span className="text-sm text-red-700">
                      Fix the {report.errors === 1 ? 'row' : 'rows'} marked in
                      red in your spreadsheet, then upload it again. Nothing is
                      saved until every row is right.
                    </span>
                  )}
                </div>
              </>
            )}

            {report.errors > 0 && !report.saved && (
              <label className="mt-4 flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={onlyAttention}
                  onChange={(event) => setOnlyAttention(event.target.checked)}
                />
                Show only the rows that need a look
              </label>
            )}

            <div className="mt-3 overflow-x-auto rounded-md border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Row</th>
                    <th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2">Units and prices</th>
                    <th className="px-3 py-2">What happens</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shown.map((row) => (
                    <ReportRow key={row.line} row={row} saved={report.saved} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </Page>
  );
}

function ReportRow({ row, saved }: { row: ImportRowView; saved: boolean }) {
  const product = row.product;
  const tone =
    row.status === 'error'
      ? 'bg-red-50/60'
      : row.status === 'skip'
        ? 'text-slate-500'
        : '';

  return (
    <tr className={`align-top ${tone}`}>
      <td className="px-3 py-2 text-slate-500">{row.line}</td>
      <td className="px-3 py-2">
        <div className="font-medium text-slate-900">{row.name || '—'}</div>
        {product && (
          <div className="text-xs text-slate-500">
            {[
              product.size,
              product.category &&
                `${product.category.name}${product.category.isNew ? ' (new)' : ''}`,
              product.barcode?.code,
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
        )}
      </td>
      <td className="px-3 py-2">
        {product && (
          <ul className="space-y-0.5 text-xs">
            {product.units.map((unit) => (
              <li
                key={unit.name}
                className={
                  unit.isSellable ? 'text-slate-700' : 'text-slate-400'
                }
              >
                {unit.isBase ? unit.name : `${unit.name} of ${unit.factor}`}{' '}
                {unit.price !== null ? (
                  <Money value={unit.price} />
                ) : (
                  <span className="text-slate-400">no price</span>
                )}
                {!unit.isSellable && ' · counted, not sold'}
                {unit.isDefaultSelling &&
                  unit.isSellable &&
                  ' · first at the till'}
              </li>
            ))}
          </ul>
        )}
      </td>
      <td className="px-3 py-2">
        <div
          className={
            row.status === 'error'
              ? 'font-medium text-red-700'
              : row.status === 'skip'
                ? 'text-slate-500'
                : 'text-emerald-700'
          }
        >
          {row.status === 'error'
            ? 'Needs fixing'
            : row.status === 'skip'
              ? 'Skipped'
              : saved
                ? 'Added'
                : 'Will add'}
        </div>
        {row.messages.length > 0 && (
          <ul
            className={`mt-0.5 space-y-0.5 text-xs ${
              row.status === 'error' ? 'text-red-700' : 'text-amber-700'
            }`}
          >
            {row.messages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  );
}

function messageFor(caught: unknown): string {
  return caught instanceof ApiError
    ? caught.message
    : 'Could not reach the server. Check the connection and try again.';
}
