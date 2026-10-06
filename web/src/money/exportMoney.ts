import { api } from '../api/client';
import type { components } from '../api/schema';
import {
  allPages,
  downloadSheet,
  stamp,
  type SheetColumn,
} from '../lib/exportSheet';
import { PAY_STATE_LABEL, payState } from '../lib/payState';

type SaleView = components['schemas']['SaleView'];
type SaleListView = components['schemas']['SaleListView'];
type SupplierBillView = components['schemas']['SupplierBillView'];
type PaymentView = components['schemas']['PaymentView'];
type PaymentListView = components['schemas']['PaymentListView'];
type SupplierPaymentView = components['schemas']['SupplierPaymentView'];
type SupplierPaymentListView = components['schemas']['SupplierPaymentListView'];

/**
 * The four lists an accountant asks for — invoices, bills, money in, money
 * out — as spreadsheets.
 *
 * **The whole list, not the page on screen**: a screen shows fifty, a file
 * wants them all, so these walk the same endpoint the screen reads, newest
 * first, at the largest page each allows. Only when Download is pressed.
 * Filters the screen has set (a customer, a vendor, dates) are kept.
 *
 * Every figure is the server's — `balance`, `allocated`, `paid` — and the
 * status is named from them by `payState`, the same as the badge on screen.
 */

const personName = (
  person: { firstName: string; lastName: string | null } | null,
) =>
  person ? [person.firstName, person.lastName].filter(Boolean).join(' ') : '';

const METHOD: Record<string, string> = {
  cash: 'Cash',
  transfer: 'Transfer',
  pos: 'POS',
  cheque: 'Cheque',
};

// ── Invoices ──────────────────────────────────────────────────────────────

const INVOICE_COLUMNS: readonly SheetColumn<SaleView>[] = [
  { header: 'Date', kind: 'date', value: (sale) => sale.occurredAt },
  { header: 'Invoice', value: (sale) => sale.number, width: 12 },
  {
    header: 'Customer',
    value: (sale) => (sale.customer ? personName(sale.customer) : 'Walk-in'),
    width: 26,
  },
  { header: 'Total', kind: 'money', value: (sale) => sale.total },
  { header: 'of which VAT', kind: 'money', value: (sale) => sale.taxTotal },
  { header: 'Paid', kind: 'money', value: (sale) => sale.allocated },
  { header: 'Refunded', kind: 'money', value: (sale) => sale.refunded },
  { header: 'Owing', kind: 'money', value: (sale) => sale.balance },
  {
    header: 'Status',
    value: (sale) => PAY_STATE_LABEL[payState(sale.balance, sale.allocated)],
    width: 10,
  },
  { header: 'Location', value: (sale) => sale.location.name, width: 16 },
];

export async function exportInvoices(customerId: string): Promise<void> {
  const sales = await allPages<SaleView>(async (cursor) => {
    const query = new URLSearchParams({ order: 'desc', limit: '500' });
    if (customerId) query.set('customerId', customerId);
    if (cursor) query.set('cursor', cursor);
    const page = await api.get<SaleListView>(`/sales?${query}`);
    return { items: page.sales, nextCursor: page.nextCursor };
  });
  await downloadSheet(stamp('invoices'), INVOICE_COLUMNS, sales);
}

// ── Bills ─────────────────────────────────────────────────────────────────

const BILL_COLUMNS: readonly SheetColumn<SupplierBillView>[] = [
  { header: 'Billed on', kind: 'date', value: (bill) => bill.issuedAt },
  { header: 'Vendor', value: (bill) => bill.supplier.name, width: 26 },
  { header: 'Vendor invoice', value: (bill) => bill.invoiceNumber, width: 16 },
  { header: 'Due', kind: 'date', value: (bill) => bill.dueDate },
  { header: 'Billed', kind: 'money', value: (bill) => bill.amountDue },
  { header: 'Paid', kind: 'money', value: (bill) => bill.paid },
  { header: 'Rebate', kind: 'money', value: (bill) => bill.rebated },
  { header: 'Owing', kind: 'money', value: (bill) => bill.balance },
  {
    header: 'Status',
    value: (bill) => PAY_STATE_LABEL[payState(bill.balance, bill.paid)],
    width: 10,
  },
  {
    header: 'From',
    value: (bill) => (bill.goodsReceipt ? 'Delivery' : 'Owed from before'),
    width: 16,
  },
];

/** The bills already on screen — that list is every bill, not a page. */
export function exportBills(bills: readonly SupplierBillView[]): Promise<void> {
  return downloadSheet(stamp('bills'), BILL_COLUMNS, bills);
}

// ── Money in ──────────────────────────────────────────────────────────────

const MONEY_IN_COLUMNS: readonly SheetColumn<PaymentView>[] = [
  { header: 'Paid on', kind: 'date', value: (row) => row.occurredAt },
  {
    header: 'From',
    value: (row) => (row.customer ? personName(row.customer) : 'Walk-in'),
    width: 26,
  },
  { header: 'Method', value: (row) => METHOD[row.method] ?? row.method },
  {
    header: 'Into account',
    value: (row) => row.bankAccount?.bankName,
    width: 18,
  },
  { header: 'Reference', value: (row) => row.reference, width: 18 },
  { header: 'Amount', kind: 'money', value: (row) => row.amount },
  {
    header: 'Paid invoices',
    value: (row) =>
      row.allocations.map((allocation) => allocation.sale.number).join(', '),
    width: 28,
  },
  { header: 'Left as credit', kind: 'money', value: (row) => row.unallocated },
  {
    header: 'Voided',
    value: (row) =>
      row.voidedAt ? `Yes — ${row.voidedReason ?? 'no reason given'}` : '',
    width: 24,
  },
];

/** Money in, with the filters the screen has set. */
export async function exportMoneyIn(filters: URLSearchParams): Promise<void> {
  const payments = await allPages<PaymentView>(async (cursor) => {
    const query = new URLSearchParams(filters);
    query.set('order', 'desc');
    query.set('limit', '500');
    if (cursor) query.set('cursor', cursor);
    else query.delete('cursor');
    const page = await api.get<PaymentListView>(`/payments?${query}`);
    return { items: page.payments, nextCursor: page.nextCursor };
  });
  await downloadSheet(stamp('money-in'), MONEY_IN_COLUMNS, payments);
}

// ── Money out ─────────────────────────────────────────────────────────────

const MONEY_OUT_COLUMNS: readonly SheetColumn<SupplierPaymentView>[] = [
  { header: 'Paid on', kind: 'date', value: (row) => row.occurredAt },
  { header: 'Vendor', value: (row) => row.supplier.name, width: 26 },
  { header: 'Against bill', value: (row) => row.bill.invoiceNumber, width: 16 },
  { header: 'Bill date', kind: 'date', value: (row) => row.bill.issuedAt },
  { header: 'Method', value: (row) => METHOD[row.method] ?? row.method },
  {
    header: 'From account',
    value: (row) => row.bankAccount?.bankName,
    width: 18,
  },
  { header: 'Reference', value: (row) => row.reference, width: 18 },
  { header: 'Amount', kind: 'money', value: (row) => row.amount },
  {
    header: 'Voided',
    value: (row) =>
      row.voidedAt ? `Yes — ${row.voidedReason ?? 'no reason given'}` : '',
    width: 24,
  },
];

export async function exportMoneyOut(supplierId: string): Promise<void> {
  const payments = await allPages<SupplierPaymentView>(async (cursor) => {
    const query = new URLSearchParams({ order: 'desc', limit: '200' });
    if (supplierId) query.set('supplierId', supplierId);
    if (cursor) query.set('cursor', cursor);
    const page = await api.get<SupplierPaymentListView>(
      `/supplier-payments?${query}`,
    );
    return { items: page.payments, nextCursor: page.nextCursor };
  });
  await downloadSheet(stamp('money-out'), MONEY_OUT_COLUMNS, payments);
}
