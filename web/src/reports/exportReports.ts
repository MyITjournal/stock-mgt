import type { components } from '../api/schema';
import {
  downloadWorkbook,
  stamp,
  tab,
  type SheetColumn,
} from '../lib/exportSheet';

type S = components['schemas'];

/**
 * Each report as a spreadsheet: the tables the screen shows, for the period
 * it shows, from the response it already holds — no second request, and no
 * figure the screen does not have. A report that groups the same figures
 * several ways is one file with a tab per table.
 *
 * Cost-bearing columns read fields `redactCost` may have removed, so for a role
 * that may not see cost they are simply empty — never zero.
 */

const fileFor = (report: string, period: S['PeriodView']) =>
  stamp(`${report}-${period.name}`);

/** The period the file covers, as its own first tab, so a file says it. */
function periodTab(period: S['PeriodView']) {
  return tab(
    'Period',
    [
      { header: 'Period', value: (p: S['PeriodView']) => p.name },
      { header: 'From', kind: 'date', value: (p: S['PeriodView']) => p.from },
      { header: 'To', kind: 'date', value: (p: S['PeriodView']) => p.to },
      { header: 'Time zone', value: (p: S['PeriodView']) => p.timezone },
    ],
    [period],
  );
}

export function exportProfit(data: S['ProfitReportView']) {
  type Line = { label: string; value: number; kind: 'money' | 'percent' };
  const lines: Line[] = [
    { label: 'Sold, including VAT', value: data.grossSales, kind: 'money' },
    { label: 'Less VAT', value: -data.tax, kind: 'money' },
    { label: 'Less returns', value: -data.returned, kind: 'money' },
    { label: 'Revenue', value: data.revenue, kind: 'money' },
    { label: 'Less cost of goods', value: -data.cogs, kind: 'money' },
    { label: 'Gross profit', value: data.grossProfit, kind: 'money' },
    { label: 'Margin', value: data.marginBps, kind: 'percent' },
    { label: 'Plus vendor rebates', value: data.vendorRebates, kind: 'money' },
    { label: 'Less expenses', value: -data.expenses, kind: 'money' },
    { label: 'After expenses', value: data.operatingProfit, kind: 'money' },
    {
      label: 'Of the cost of goods, estimated',
      value: data.estimatedCost,
      kind: 'money',
    },
  ];
  // Two columns so each line keeps its own format: money, or a percentage.
  return downloadWorkbook(fileFor('profit', data.period), [
    tab(
      'Profit',
      [
        { header: 'Line', value: (row: Line) => row.label, width: 34 },
        {
          header: 'Amount (NGN)',
          kind: 'money',
          value: (row: Line) => (row.kind === 'money' ? row.value : null),
        },
        {
          header: 'Percent',
          kind: 'percent',
          value: (row: Line) => (row.kind === 'percent' ? row.value : null),
        },
      ],
      lines,
    ),
    periodTab(data.period),
  ]);
}

const salesColumns = (
  groupLabel: string,
): readonly SheetColumn<S['SalesGroupRow']>[] => [
  { header: groupLabel, value: (row) => row.label, width: 30 },
  { header: 'Sold, with VAT', kind: 'money', value: (row) => row.grossSales },
  { header: 'Returned', kind: 'money', value: (row) => row.returned },
  { header: 'Revenue', kind: 'money', value: (row) => row.revenue },
  { header: 'Cost of goods', kind: 'money', value: (row) => row.cogs },
  { header: 'Gross profit', kind: 'money', value: (row) => row.grossProfit },
  { header: 'Margin', kind: 'percent', value: (row) => row.marginBps },
  { header: 'Units', kind: 'number', value: (row) => row.units },
  { header: 'Invoices', kind: 'number', value: (row) => row.invoices },
];

export function exportSales(data: S['SalesReportView'], groupLabel: string) {
  return downloadWorkbook(fileFor(`sales-by-${data.groupBy}`, data.period), [
    tab(`By ${groupLabel.toLowerCase()}`, salesColumns(groupLabel), data.rows),
    periodTab(data.period),
  ]);
}

const purchaseColumns = (
  label: string,
): readonly SheetColumn<S['PurchaseGroupRow']>[] => [
  { header: label, value: (row) => row.label, width: 30 },
  { header: 'Invoice value', kind: 'money', value: (row) => row.value },
  {
    header: 'Received (counted-in units)',
    kind: 'number',
    value: (row) => row.quantityReceived,
  },
  {
    header: 'Paid for (counted-in units)',
    kind: 'number',
    value: (row) => row.quantityPaidFor,
  },
  { header: 'Lines', kind: 'number', value: (row) => row.lines },
];

export function exportPurchases(data: S['PurchasesReportView']) {
  return downloadWorkbook(fileFor('purchases', data.period), [
    tab('By vendor', purchaseColumns('Vendor'), data.bySupplier),
    tab('By category', purchaseColumns('Category'), data.byCategory),
    tab('Most bought', purchaseColumns('Product'), data.topProducts),
    periodTab(data.period),
  ]);
}

export function exportCollections(
  data: S['CollectionsView'],
  period: S['PeriodView'],
) {
  return downloadWorkbook(fileFor('collections', period), [
    tab(
      'How it came in',
      [
        {
          header: 'Method',
          value: (row: S['CollectionsByMethod']) => row.method,
        },
        {
          header: 'Collected',
          kind: 'money',
          value: (row: S['CollectionsByMethod']) => row.total,
        },
      ],
      data.byMethod,
    ),
    tab(
      'Which till',
      [
        {
          header: 'Location',
          value: (row: S['CollectionsByLocation']) => row.label,
          width: 24,
        },
        {
          header: 'Collected',
          kind: 'money',
          value: (row: S['CollectionsByLocation']) => row.total,
        },
        {
          header: 'Payments',
          kind: 'number',
          value: (row: S['CollectionsByLocation']) => row.count,
        },
      ],
      data.byLocation,
    ),
    tab(
      'Which account',
      [
        {
          header: 'Account',
          value: (row: S['CollectionsByAccount']) => row.label,
          width: 28,
        },
        {
          header: 'Collected',
          kind: 'money',
          value: (row: S['CollectionsByAccount']) => row.total,
        },
        {
          header: 'Payments',
          kind: 'number',
          value: (row: S['CollectionsByAccount']) => row.count,
        },
      ],
      data.byBankAccount,
    ),
    periodTab(period),
  ]);
}

const customerName = (row: S['CustomerReportRow']) =>
  [row.customer.firstName, row.customer.lastName].filter(Boolean).join(' ');

const customerColumns: readonly SheetColumn<S['CustomerReportRow']>[] = [
  { header: 'Customer', value: customerName, width: 28 },
  { header: 'Phone', value: (row) => row.customer.phone, width: 16 },
  { header: 'Invoices', kind: 'number', value: (row) => row.invoices },
  { header: 'Spend', kind: 'money', value: (row) => row.spend },
  { header: 'Gross profit', kind: 'money', value: (row) => row.grossProfit },
  { header: 'Margin', kind: 'percent', value: (row) => row.marginBps },
  { header: 'Spend, ever', kind: 'money', value: (row) => row.lifetimeSpend },
  { header: 'Owes now', kind: 'money', value: (row) => row.balance },
  { header: 'Last bought', kind: 'date', value: (row) => row.lastPurchase },
];

export function exportMovers(
  products: S['ProductReportView'],
  customers: S['CustomerReportView'] | undefined,
) {
  return downloadWorkbook(fileFor('movers', products.period), [
    tab('Best by revenue', salesColumns('Product'), products.topByRevenue),
    tab('Best by units', salesColumns('Product'), products.topByUnits),
    tab('Thinnest margins', salesColumns('Product'), products.byMargin),
    tab(
      'Not moving',
      [
        {
          header: 'Product',
          value: (row: S['DeadStockRow']) => row.product.name,
          width: 30,
        },
        { header: 'SKU', value: (row: S['DeadStockRow']) => row.product.sku },
        {
          header: 'On hand (counted-in units)',
          kind: 'number',
          value: (row: S['DeadStockRow']) => row.quantity,
        },
      ],
      products.deadStock,
    ),
    ...(customers
      ? [
          tab('Customers', customerColumns, customers.customers),
          tab('Not back lately', customerColumns, customers.lapsed),
        ]
      : []),
    periodTab(products.period),
  ]);
}

const valuationColumns = (
  label: string,
): readonly SheetColumn<S['ValuationGroupRow']>[] => [
  { header: label, value: (row) => row.label, width: 30 },
  { header: 'Value at cost', kind: 'money', value: (row) => row.value },
  {
    header: 'Units (counted-in)',
    kind: 'number',
    value: (row) => row.units,
  },
];

/** Stock value now — not a period, so the file is stamped with today. */
export function exportStockValue(data: S['StockValuationView']) {
  return downloadWorkbook(stamp('stock-value'), [
    tab('By product', valuationColumns('Product'), data.byProduct),
    tab('By category', valuationColumns('Category'), data.byCategory),
    tab('By location', valuationColumns('Location'), data.byLocation),
  ]);
}
