import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { DataTable, type Column } from '../components/DataTable';
import { Money } from '../components/Money';
import { Button } from '../components/Button';
import { Field, Input, Select } from '../components/Field';
import { api } from '../api/client';
import { useRecordsStock, useSeesCost } from '../auth/useAuth';
import type { components } from '../api/schema';

type GoodsReceiptSummary = components['schemas']['GoodsReceiptSummary'];
type SupplierView = components['schemas']['SupplierView'];
type LocationView = components['schemas']['LocationView'];

/**
 * Deliveries.
 *
 * **There are no purchase orders here, and that is a decision rather than a
 * gap** (DECISIONS.md §6). Orders go by phone in this market; what gets
 * recorded is the goods arriving. Do not read the absence of an "expected
 * delivery" as something missing.
 *
 * **Receipt is goods, bill is money.** Every delivery also raises a
 * `SupplierBill`, which is what shows on Money → We owe. This screen is what
 * physically arrived; what is owed for it lives over there (§16).
 */
export function ReceiptsPage() {
  const navigate = useNavigate();
  const seesCost = useSeesCost();
  const recordsStock = useRecordsStock();

  const [supplierId, setSupplierId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');

  const query = new URLSearchParams();
  if (supplierId) query.set('supplierId', supplierId);
  if (locationId) query.set('locationId', locationId);
  if (since) query.set('since', new Date(since).toISOString());
  if (until) query.set('until', new Date(`${until}T23:59:59`).toISOString());

  const { data: receipts = [], isPending } = useQuery({
    queryKey: ['goods-receipts', query.toString()],
    queryFn: () => api.get<GoodsReceiptSummary[]>(`/goods-receipts?${query}`),
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api.get<SupplierView[]>('/suppliers'),
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: () => api.get<LocationView[]>('/locations'),
  });

  const columns: readonly Column<GoodsReceiptSummary>[] = [
    {
      header: 'Arrived',
      cell: (row) => (
        <span className="whitespace-nowrap">
          {new Date(row.receivedAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      header: 'Vendor',
      cell: (row) => (
        <span className="font-medium text-slate-900">{row.supplier.name}</span>
      ),
    },
    {
      header: 'Invoice',
      cell: (row) =>
        row.invoiceNumber ?? <span className="text-slate-400">—</span>,
    },
    { header: 'Into', cell: (row) => row.location.name },
    {
      header: 'Lines',
      numeric: true,
      cell: (row) => row.lines.length,
    },
    {
      header: 'Received',
      numeric: true,
      cell: (row) => (
        <span className="tabular-nums">
          {row.lines.reduce((sum, line) => sum + line.quantityReceived, 0)}
        </span>
      ),
    },
    ...(seesCost
      ? [
          {
            header: 'Goods value',
            numeric: true,
            // The sum of the exact invoice totals, never costPrice × quantity.
            cell: (row: GoodsReceiptSummary) => (
              <Money
                value={row.lines.reduce(
                  (sum, line) => sum + (line.totalCost ?? 0),
                  0,
                )}
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <Page
      title="Deliveries"
      description="What arrived, from whom, and what the invoice said."
      actions={
        recordsStock ? (
          <Button onClick={() => navigate('/stock/receive')}>
            Record a delivery
          </Button>
        ) : undefined
      }
    >
      <div className="mb-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-4">
        <Field label="Vendor" htmlFor="receipt-supplier">
          <Select
            id="receipt-supplier"
            value={supplierId}
            onChange={(event) => setSupplierId(event.target.value)}
          >
            <option value="">Everyone</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Location" htmlFor="receipt-location">
          <Select
            id="receipt-location"
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
          >
            <option value="">Everywhere</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="From" htmlFor="receipt-since">
          <Input
            id="receipt-since"
            type="date"
            value={since}
            onChange={(event) => setSince(event.target.value)}
          />
        </Field>

        <Field label="To" htmlFor="receipt-until">
          <Input
            id="receipt-until"
            type="date"
            value={until}
            onChange={(event) => setUntil(event.target.value)}
          />
        </Field>
      </div>

      <DataTable
        rows={receipts}
        columns={columns}
        rowKey={(row) => row.id}
        loading={isPending}
        onRowClick={(row) => navigate(`/stock/receipts/${row.id}`)}
        empty="No deliveries in this window."
      />
    </Page>
  );
}
