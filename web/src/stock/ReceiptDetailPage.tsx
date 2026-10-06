import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { DataTable, type Column } from '../components/DataTable';
import { Money } from '../components/Money';
import { api, ApiError } from '../api/client';
import { useIsManager, useSeesCost } from '../auth/useAuth';
import { Button } from '../components/Button';
import { CorrectDeliveryDialog } from './CorrectDeliveryDialog';
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
 *
 * **A delivery entered wrong is corrected, not edited** — owner or manager,
 * any number of times. The lines show the true figures; every correction is
 * listed underneath with what the figures were before, who, when and why.
 */
export function ReceiptDetailPage() {
  const { id = '' } = useParams();
  const seesCost = useSeesCost();
  const canCorrect = useIsManager();
  const [correcting, setCorrecting] = useState(false);

  const {
    data: receipt,
    isPending,
    error,
  } = useQuery({
    queryKey: ['goods-receipt', id],
    queryFn: () => api.get<GoodsReceiptView>(`/goods-receipts/${id}`),
  });

  if (isPending) {
    return (
      <Page
        back={{ to: '/stock/receipts', label: 'Deliveries' }}
        title="Delivery"
      >
        <p className="text-sm text-slate-500">Loading…</p>
      </Page>
    );
  }

  if (error || !receipt) {
    return (
      <Page
        back={{ to: '/stock/receipts', label: 'Deliveries' }}
        title="Delivery"
      >
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
      back={{ to: '/stock/receipts', label: 'Deliveries' }}
      title={receipt.supplier.name}
      description={`Arrived ${new Date(receipt.receivedAt).toLocaleString()} into ${receipt.location.name}`}
      actions={
        canCorrect && (
          <Button variant="secondary" onClick={() => setCorrecting(true)}>
            Correct this delivery
          </Button>
        )
      }
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

      {(receipt.corrections ?? []).length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold text-slate-900">Corrections</h2>
          <ul className="mt-2 space-y-2">
            {(receipt.corrections ?? []).map((correction) => (
              <li
                key={correction.id}
                className="rounded-md border border-slate-200 bg-white p-3 text-sm"
              >
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium text-slate-900">
                    {correction.reason}
                  </span>
                  <span className="text-xs text-slate-500">
                    {new Date(correction.createdAt).toLocaleString()}
                    {correction.recordedBy &&
                      ` · ${[correction.recordedBy.firstName, correction.recordedBy.lastName].filter(Boolean).join(' ')}`}
                  </span>
                </div>
                <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                  {correction.lines.map((row) => {
                    const name =
                      receipt.lines.find(
                        (line) => line.id === row.receiptLineId,
                      )?.product.name ?? 'A line';
                    return (
                      <li key={row.receiptLineId}>
                        {name}: received {row.receivedBefore} →{' '}
                        {row.receivedAfter}, paid for {row.paidForBefore} →{' '}
                        {row.paidForAfter}
                        {row.totalCostBefore !== undefined &&
                          row.totalCostAfter !== undefined && (
                            <>
                              , value <Money value={row.totalCostBefore} /> →{' '}
                              <Money value={row.totalCostAfter} />
                            </>
                          )}{' '}
                        <span className="text-slate-400">(base units)</span>
                      </li>
                    );
                  })}
                  {correction.billAmountBefore != null &&
                    correction.billAmountAfter != null && (
                      <li>
                        Bill: <Money value={correction.billAmountBefore} /> →{' '}
                        <Money value={correction.billAmountAfter} />
                      </li>
                    )}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      {correcting && (
        <CorrectDeliveryDialog
          receipt={receipt}
          onClose={() => setCorrecting(false)}
        />
      )}

      <p className="mt-4 text-sm text-slate-500">
        What is owed for this delivery is a bill, not a receipt — see{' '}
        <Link to="/money/payables" className="underline">
          Money → Bills
        </Link>
        . The goods value above is what the stock lines came to, which the
        vendor&rsquo;s invoice total can legitimately differ from.
      </p>
    </Page>
  );
}
