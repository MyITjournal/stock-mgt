import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { DataTable, type Column } from '../components/DataTable';
import { Money } from '../components/Money';
import { api, ApiError } from '../api/client';
import { useSeesCost } from '../auth/useAuth';
import type { components } from '../api/schema';

type GoodsReceiptView = components['schemas']['GoodsReceiptView'];
type GoodsReceiptLineView = components['schemas']['GoodsReceiptLineView'];

/**
 * One delivery.
 *
 * Two figures on each line say different things and must not be collapsed:
 * **received** is what physically arrived and moved the ledger, **paid for**
 * is what the invoice charged. "Buy 19, get 1 free" is 20 and 19, and the gap
 * is the free goods — which is also why `unitCost` divides by what arrived
 * rather than what was billed, pulling the cost of every unit down
 * (DECISIONS.md §2).
 *
 * The money is a buying price, so every figure here is **absent** rather than
 * zero for a role that may not see cost (§9).
 */
export function ReceiptDetailPage() {
  const { id = '' } = useParams();
  const seesCost = useSeesCost();

  const { data: receipt, isPending, error } = useQuery({
    queryKey: ['goods-receipt', id],
    queryFn: () => api.get<GoodsReceiptView>(`/goods-receipts/${id}`),
  });

  if (isPending) {
    return (
      <Page title="Delivery">
        <p className="text-sm text-slate-500">Loading…</p>
      </Page>
    );
  }

  if (error || !receipt) {
    return (
      <Page title="Delivery">
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error instanceof ApiError
            ? error.message
            : 'That delivery could not be loaded.'}
        </p>
      </Page>
    );
  }

  const goodsValue = receipt.lines.reduce(
    (sum, line) => sum + (line.totalCost ?? 0),
    0,
  );
  const freeGoods = receipt.lines.reduce(
    (sum, line) => sum + (line.quantityReceived - line.quantityPaidFor),
    0,
  );

  const columns: readonly Column<GoodsReceiptLineView>[] = [
    {
      header: 'Product',
      cell: (line) => (
        <span>
          <span className="block font-medium text-slate-900">
            {line.product.name}
          </span>
          <span className="block text-xs text-slate-500">
            {line.product.sku}
          </span>
        </span>
      ),
    },
    {
      header: 'Counted in',
      cell: (line) => (
        <span>
          {line.unit.name}
          {line.unitFactor === 1 ? '' : ` × ${line.unitFactor}`}
        </span>
      ),
    },
    {
      header: 'Received',
      numeric: true,
      cell: (line) => (
        <span className="tabular-nums">
          {line.quantityReceivedInUnit}
          <span className="text-xs text-slate-500">
            {' '}
            ({line.quantityReceived})
          </span>
        </span>
      ),
    },
    {
      header: 'Paid for',
      numeric: true,
      cell: (line) => (
        <span className="tabular-nums">
          {line.quantityPaidForInUnit}
          {line.quantityReceived > line.quantityPaidFor && (
            <span className="ml-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
              free goods
            </span>
          )}
        </span>
      ),
    },
    {
      header: 'Lot',
      cell: (line) => (
        <span className="text-xs text-slate-600">
          {line.batch.lotCode ?? '—'}
          {line.batch.expiryDate && (
            <span className="block text-slate-400">
              expires {new Date(line.batch.expiryDate).toLocaleDateString()}
            </span>
          )}
        </span>
      ),
    },
    ...(seesCost
      ? [
          {
            header: 'Cost each',
            numeric: true,
            cell: (line: GoodsReceiptLineView) => (
              <Money value={line.unitCost} />
            ),
          },
          {
            header: 'Line total',
            numeric: true,
            cell: (line: GoodsReceiptLineView) => (
              <Money value={line.totalCost} />
            ),
          },
        ]
      : []),
  ];

  return (
    <Page
      title={receipt.supplier.name}
      description={`Arrived ${new Date(receipt.receivedAt).toLocaleString()} into ${receipt.location.name}`}
    >
      <div className="mb-4 flex flex-wrap gap-6 rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <div>
          <div className="text-xs uppercase text-slate-500">Invoice</div>
          <div className="text-slate-900">{receipt.invoiceNumber ?? '—'}</div>
        </div>
        <div>
          <div className="text-xs uppercase text-slate-500">Recorded by</div>
          <div className="text-slate-900">
            {receipt.recordedBy
              ? `${receipt.recordedBy.firstName ?? ''} ${receipt.recordedBy.lastName ?? ''}`.trim() ||
                '—'
              : '—'}
          </div>
        </div>
        {seesCost && (
          <div>
            <div className="text-xs uppercase text-slate-500">Goods value</div>
            <div className="text-slate-900">
              <Money value={goodsValue} />
            </div>
          </div>
        )}
        {freeGoods > 0 && (
          <div>
            <div className="text-xs uppercase text-slate-500">Free goods</div>
            <div className="text-slate-900">{freeGoods} base units</div>
          </div>
        )}
      </div>

      <DataTable
        rows={receipt.lines}
        columns={columns}
        rowKey={(line) => line.id}
        empty="This delivery has no lines, which should not be possible."
      />

      {receipt.note && (
        <p className="mt-4 rounded-md bg-slate-50 p-3 text-sm text-slate-600">
          {receipt.note}
        </p>
      )}

      <p className="mt-4 text-sm text-slate-500">
        What is owed for this delivery is a bill, not a receipt — see{' '}
        <Link to="/money/payables" className="underline">
          Money → We owe
        </Link>
        . The goods value above is what the stock lines came to, which the
        vendor&rsquo;s invoice total can legitimately differ from.
      </p>
    </Page>
  );
}
