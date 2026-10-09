import type {
  Content,
  TableCell,
  TDocumentDefinitions,
} from 'pdfmake/interfaces';

/** pdfmake accepts a number or a tuple; a bare array literal widens and fails. */
type Margin = [number, number, number, number];
import type { PaymentMethod } from '@prisma/client';
import { presentLines, printDate, printMoney } from './pdf';
import type { PaidBy } from '../sales/receipt';

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
  /** How `paid` came in, a line per method — see `paidByMethod`. */
  paidBy: PaidBy[];
  balance: number;
  /** Printed only while something is owed — see `SaleService.receipt`. */
  dueDate: Date | null;
  note: string | null;
  /**
   * Which copy this is and when it was made (2026-10-09). Copy 1, or none,
   * prints as it always has; every later one is marked — see `copyMark`.
   */
  copy?: { number: number; madeAt: Date } | null;
}

/**
 * "COPY 2", and when it was made, for every copy after the first — so a
 * reprint cannot be handed over as the original. Null for the original.
 */
export function copyMark(
  copy: InvoiceDocument['copy'],
  timezone: string,
): { title: string; detail: string } | null {
  if (!copy || copy.number < 2) return null;
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  }).format(copy.madeAt);
  return {
    title: `COPY ${copy.number}`,
    detail: `Not the original · made ${printDate(copy.madeAt, timezone)}, ${time}`,
  };
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
  const mark = copyMark(invoice.copy, org.timezone);

  const content: Content[] = [
    letterhead(org),
    {
      columns: [
        {
          width: '*',
          stack: [
            { text: 'INVOICE', style: 'documentTitle' },
            { text: invoice.number, style: 'documentNumber' },
            // Under the number, where whoever checks a receipt looks first.
            ...(mark
              ? [
                  {
                    text: mark.title,
                    bold: true,
                    fontSize: 13,
                    margin: [0, 6, 0, 0] as Margin,
                  },
                  { text: mark.detail, style: 'label' },
                ]
              : []),
          ],
        },
        {
          width: 'auto',
          alignment: 'right',
          stack: [
            { text: 'Date', style: 'label' },
            { text: printDate(invoice.occurredAt, org.timezone) },
            // A credit sale tells the customer when to pay, on the document
            // they pay from — the same date the shop's reminder counts from.
            ...(invoice.dueDate
              ? [
                  {
                    text: 'Payment due by',
                    style: 'label',
                    margin: [0, 6, 0, 0] as Margin,
                  },
                  {
                    text: printDate(invoice.dueDate, org.timezone),
                    bold: true,
                  },
                ]
              : []),
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
              // A sale that carried no VAT — a shop that does not charge it —
              // prints no VAT line at all: "of which VAT NGN 0.00" on a
              // non-VAT shop's invoice reads as if it ought to have some. This
              // follows the sale, not the shop's switch today, so an old VAT
              // invoice reprinted after switching off still shows its VAT.
              ...(invoice.tax > 0
                ? [totalRow('of which VAT', money(invoice.tax))]
                : []),
              ...paidRows(invoice, money),
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
    // A5, half an A4 sheet (2026-10-06): an invoice is a header, a few lines
    // and the accounts to pay into, and on A4 most of the page was blank paper.
    // A long invoice still breaks onto a second page. The statement stays A4 —
    // it is a list that grows, and is sent more often than printed.
    ...INVOICE_PAGE,
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
      margin: [INVOICE_SIDE_MARGIN, 8, INVOICE_SIDE_MARGIN, 0] as Margin,
    }),
    styles: { ...DOCUMENT_STYLES, ...INVOICE_STYLES },
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

/** As a customer reads it: "POS", not "pos". */
const METHOD_NAMES: Record<PaymentMethod, string> = {
  cash: 'cash',
  transfer: 'transfer',
  pos: 'POS',
  cheque: 'cheque',
};

/**
 * "Paid" with how it was paid (2026-10-09). Paid one way, the method sits in
 * the label: "Paid by cash". Paid several ways, "Paid" carries the total and a
 * smaller line per method follows. Nothing paid yet, a plain "Paid" as before.
 */
export function paidRows(
  invoice: Pick<InvoiceDocument, 'paid' | 'paidBy'>,
  money: (value: number) => string,
): TableCell[][] {
  const [only, ...more] = invoice.paidBy;
  if (only && more.length === 0) {
    return [
      totalRow(`Paid by ${METHOD_NAMES[only.method]}`, money(invoice.paid)),
    ];
  }
  return [
    totalRow('Paid', money(invoice.paid)),
    ...invoice.paidBy.map(({ method, amount }): TableCell[] => [
      {
        text: capitalise(METHOD_NAMES[method]),
        alignment: 'right',
        style: 'note',
      },
      {
        text: money(amount),
        alignment: 'right',
        style: 'note',
        margin: [12, 0, 0, 0] as Margin,
      },
    ]),
  ];
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
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

/** Points; A5 is 420 × 595, so this leaves 364 across for the table. */
const INVOICE_SIDE_MARGIN = 28;

export const INVOICE_PAGE = {
  pageSize: 'A5',
  pageMargins: [INVOICE_SIDE_MARGIN, 28, INVOICE_SIDE_MARGIN, 36] as Margin,
  defaultStyle: { font: 'Helvetica', fontSize: 8 },
} as const;

/** A step smaller than the A4 statement's, so the page keeps its proportions. */
const INVOICE_STYLES = {
  businessName: { fontSize: 13, bold: true },
  documentTitle: { fontSize: 12, bold: true },
  documentNumber: { fontSize: 10 },
  tableHeader: { bold: true, fontSize: 8 },
  label: { fontSize: 7, bold: true, color: '#555555' },
  note: { fontSize: 7, color: '#555555' },
};

export const DOCUMENT_STYLES = {
  businessName: { fontSize: 15, bold: true },
  documentTitle: { fontSize: 13, bold: true },
  documentNumber: { fontSize: 11 },
  label: { fontSize: 8, bold: true, color: '#555555' },
  tableHeader: { bold: true, fontSize: 9 },
  note: { fontSize: 8, color: '#555555' },
  footer: { fontSize: 7, color: '#777777' },
};
