import type {
  Content,
  TableCell,
  TDocumentDefinitions,
} from 'pdfmake/interfaces';

/** pdfmake accepts a number or a tuple; a bare array literal widens and fails. */
type Margin = [number, number, number, number];
import { presentLines, printDate, printMoney } from './pdf';

/** The business issuing the document. Every field but the name may be absent. */
export interface Letterhead {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  taxId: string | null;
  rcNumber: string | null;
  logoUrl: string | null;
  currency: string;
  timezone: string;
}

/** An account a customer may pay into, as printed. */
export interface PayableAccount {
  bankName: string;
  accountName: string;
  accountNumber: string;
}

export interface InvoiceLine {
  description: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface InvoiceDocument {
  number: string;
  occurredAt: Date;
  customer: string | null;
  servedBy: string | null;
  lines: InvoiceLine[];
  total: number;
  tax: number;
  paid: number;
  balance: number;
  note: string | null;
}

/**
 * A printable invoice.
 *
 * Deliberately separate from `GET /sales/:id/receipt`, which stays the narrow
 * payload a thermal printer depends on (§6). This one is the document a
 * customer is sent to pay from, so it carries the letterhead, the tax split and
 * the accounts to pay into — none of which belong on a till roll.
 */
export function invoiceDefinition(args: {
  organization: Letterhead;
  accounts: PayableAccount[];
  invoice: InvoiceDocument;
}): TDocumentDefinitions {
  const { organization: org, accounts, invoice } = args;
  const money = (value: number) => printMoney(value, org.currency);

  const content: Content[] = [
    letterhead(org),
    {
      columns: [
        {
          width: '*',
          stack: [
            { text: 'INVOICE', style: 'documentTitle' },
            { text: invoice.number, style: 'documentNumber' },
          ],
        },
        {
          width: 'auto',
          alignment: 'right',
          stack: [
            { text: 'Date', style: 'label' },
            { text: printDate(invoice.occurredAt, org.timezone) },
            ...(invoice.customer
              ? [
                  {
                    text: 'Billed to',
                    style: 'label',
                    margin: [0, 6, 0, 0] as Margin,
                  },
                  { text: invoice.customer },
                ]
              : []),
          ],
        },
      ],
      margin: [0, 16, 0, 12] as Margin,
    },
    {
      table: {
        headerRows: 1,
        // Description flexes; the numeric columns stay put so figures line up
        // down the page even when an invoice runs onto a second one.
        widths: ['*', 'auto', 'auto', 'auto', 'auto'],
        body: [
          [
            { text: 'Description', style: 'tableHeader' },
            { text: 'Unit', style: 'tableHeader' },
            { text: 'Qty', style: 'tableHeader', alignment: 'right' },
            { text: 'Price', style: 'tableHeader', alignment: 'right' },
            { text: 'Amount', style: 'tableHeader', alignment: 'right' },
          ],
          ...invoice.lines.map((line): TableCell[] => [
            line.description,
            line.unit,
            { text: String(line.quantity), alignment: 'right' },
            { text: money(line.unitPrice), alignment: 'right' },
            { text: money(line.lineTotal), alignment: 'right' },
          ]),
        ],
      },
      layout: 'lightHorizontalLines',
    },
    {
      columns: [
        { width: '*', text: '' },
        {
          width: 'auto',
          table: {
            body: [
              totalRow('Total', money(invoice.total)),
              // Prices are stored tax-inclusive and VAT is derived by
              // subtraction (§2), so this is shown as "of which", never added
              // on top. Printing it as an addition would overstate the bill.
              totalRow('of which VAT', money(invoice.tax)),
              totalRow('Paid', money(invoice.paid)),
              totalRow('Balance due', money(invoice.balance), true),
            ],
          },
          layout: 'noBorders',
        },
      ],
      margin: [0, 12, 0, 0] as Margin,
    },
    ...payableBlock(accounts),
    ...(invoice.note
      ? [{ text: invoice.note, style: 'note', margin: [0, 16, 0, 0] as Margin }]
      : []),
  ];

  return {
    info: { title: `Invoice ${invoice.number}`, author: org.name },
    content,
    footer: (page: number, total: number) => ({
      columns: [
        { text: org.name, style: 'footer' },
        {
          text: total > 1 ? `Page ${page} of ${total}` : '',
          alignment: 'right',
          style: 'footer',
        },
      ],
      margin: [40, 10, 40, 0] as Margin,
    }),
    styles: DOCUMENT_STYLES,
  };
}

/**
 * The "pay into" block — most of why a customer wants the PDF at all.
 *
 * Every active account is printed rather than only the default, because a
 * business keeps several precisely so a customer can pay into whichever bank
 * they already use. Omitted entirely when none is set up, rather than printing
 * an empty heading.
 */
export function payableBlock(accounts: PayableAccount[]): Content[] {
  if (accounts.length === 0) return [];

  return [
    {
      margin: [0, 18, 0, 0] as Margin,
      stack: [
        { text: 'Pay into', style: 'label' },
        {
          columns: accounts.slice(0, 3).map((account) => ({
            width: '*',
            stack: [
              { text: account.bankName, bold: true },
              { text: account.accountNumber },
              { text: account.accountName, style: 'note' },
            ],
          })),
          columnGap: 16,
        },
        ...(accounts.length > 3
          ? [
              {
                text: accounts
                  .slice(3)
                  .map(
                    (a) =>
                      `${a.bankName} ${a.accountNumber} (${a.accountName})`,
                  )
                  .join('  ·  '),
                style: 'note',
                margin: [0, 6, 0, 0] as Margin,
              },
            ]
          : []),
      ],
    },
  ];
}

/** Name, then whatever else the business has actually filled in. */
export function letterhead(org: Letterhead): Content {
  const identity = presentLines(
    org.rcNumber,
    org.taxId ? `TIN ${org.taxId}` : null,
  );

  return {
    columns: [
      {
        width: '*',
        stack: [
          { text: org.name, style: 'businessName' },
          {
            text: presentLines(org.address, org.phone, org.email),
            style: 'note',
          },
        ],
      },
      ...(identity
        ? [
            {
              width: 'auto',
              text: identity,
              style: 'note',
              alignment: 'right' as const,
            },
          ]
        : []),
    ],
  };
}

function totalRow(
  label: string,
  value: string,
  emphasise = false,
): TableCell[] {
  return [
    { text: label, alignment: 'right', bold: emphasise },
    {
      text: value,
      alignment: 'right',
      bold: emphasise,
      margin: [12, 0, 0, 0] as Margin,
    },
  ];
}

export const DOCUMENT_STYLES = {
  businessName: { fontSize: 15, bold: true },
  documentTitle: { fontSize: 13, bold: true },
  documentNumber: { fontSize: 11 },
  label: { fontSize: 8, bold: true, color: '#555555' },
  tableHeader: { bold: true, fontSize: 9 },
  note: { fontSize: 8, color: '#555555' },
  footer: { fontSize: 7, color: '#777777' },
};
