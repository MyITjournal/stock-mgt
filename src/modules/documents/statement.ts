import type {
  Content,
  TableCell,
  TDocumentDefinitions,
} from 'pdfmake/interfaces';

type Margin = [number, number, number, number];
import {
  DOCUMENT_STYLES,
  Letterhead,
  PayableAccount,
  letterhead,
  payableBlock,
} from './invoice';
import { printDate, printMoney } from './pdf';

export interface StatementDocument {
  customer: { name: string; phone: string | null };
  invoices: {
    number: string;
    occurredAt: Date;
    total: number;
    balance: number;
    daysOutstanding: number;
  }[];
  payments: {
    occurredAt: Date;
    amount: number;
    method: string;
    reference: string | null;
  }[];
  credit: number;
  owed: number;
}

/**
 * A customer's position, as a document you can send them.
 *
 * This is the artifact that makes chasing a debt over WhatsApp work (§6): an
 * itemised "here is what you owe and what you have paid" is answerable, where
 * "you owe me money" is an argument. That is why it lists the payments as well
 * as the debts — a statement showing only what is owed reads as an accusation
 * and invites a dispute about a payment that was in fact received.
 */
export function statementDefinition(args: {
  organization: Letterhead;
  accounts: PayableAccount[];
  statement: StatementDocument;
}): TDocumentDefinitions {
  const { organization: org, accounts, statement } = args;
  const money = (value: number) => printMoney(value, org.currency);
  const date = (value: Date) => printDate(value, org.timezone);

  const content: Content[] = [
    letterhead(org),
    {
      columns: [
        {
          width: '*',
          stack: [
            { text: 'STATEMENT OF ACCOUNT', style: 'documentTitle' },
            { text: statement.customer.name, style: 'documentNumber' },
            ...(statement.customer.phone
              ? [{ text: statement.customer.phone, style: 'note' }]
              : []),
          ],
        },
        {
          width: 'auto',
          alignment: 'right',
          stack: [
            { text: 'As at', style: 'label' },
            { text: date(new Date()) },
          ],
        },
      ],
      margin: [0, 16, 0, 12] as Margin,
    },

    {
      text: 'Outstanding invoices',
      style: 'label',
      margin: [0, 0, 0, 4] as Margin,
    },
    statement.invoices.length === 0
      ? { text: 'Nothing outstanding.', style: 'note' }
      : {
          table: {
            headerRows: 1,
            widths: ['auto', 'auto', 'auto', 'auto', '*'],
            body: [
              [
                { text: 'Invoice', style: 'tableHeader' },
                { text: 'Date', style: 'tableHeader' },
                { text: 'Total', style: 'tableHeader', alignment: 'right' },
                { text: 'Balance', style: 'tableHeader', alignment: 'right' },
                { text: 'Age', style: 'tableHeader', alignment: 'right' },
              ],
              ...statement.invoices.map((invoice): TableCell[] => [
                invoice.number,
                date(invoice.occurredAt),
                { text: money(invoice.total), alignment: 'right' },
                { text: money(invoice.balance), alignment: 'right' },
                {
                  // Oldest-first is how the list is sorted (§11): the question
                  // people ask is who has owed longest, which is a sort rather
                  // than a set of buckets.
                  text: `${invoice.daysOutstanding} days`,
                  alignment: 'right',
                },
              ]),
            ],
          },
          layout: 'lightHorizontalLines',
        },

    {
      text: 'Payments received',
      style: 'label',
      margin: [0, 16, 0, 4] as Margin,
    },
    statement.payments.length === 0
      ? { text: 'No payments recorded.', style: 'note' }
      : {
          table: {
            headerRows: 1,
            widths: ['auto', 'auto', '*', 'auto'],
            body: [
              [
                { text: 'Date', style: 'tableHeader' },
                { text: 'Method', style: 'tableHeader' },
                { text: 'Reference', style: 'tableHeader' },
                { text: 'Amount', style: 'tableHeader', alignment: 'right' },
              ],
              ...statement.payments.map((payment): TableCell[] => [
                date(payment.occurredAt),
                payment.method,
                payment.reference ?? '',
                { text: money(payment.amount), alignment: 'right' },
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
              [
                { text: 'Total owed', alignment: 'right', bold: true },
                {
                  text: money(statement.owed),
                  alignment: 'right',
                  bold: true,
                  margin: [12, 0, 0, 0] as Margin,
                },
              ],
              // Only shown when it exists: a nil credit line invites the
              // question "what is this?" on a document meant to settle one.
              ...(statement.credit !== 0
                ? [
                    [
                      { text: 'Credit on account', alignment: 'right' },
                      {
                        text: money(statement.credit),
                        alignment: 'right',
                        margin: [12, 0, 0, 0] as Margin,
                      },
                    ],
                  ]
                : []),
            ] as TableCell[][],
          },
          layout: 'noBorders',
        },
      ],
      margin: [0, 12, 0, 0] as Margin,
    },

    ...payableBlock(accounts),
  ];

  return {
    info: {
      title: `Statement — ${statement.customer.name}`,
      author: org.name,
    },
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
