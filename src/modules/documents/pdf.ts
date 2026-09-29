import PdfPrinter from 'pdfmake/src/printer';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';

/**
 * PDF rendering, kept to one file and one dependency.
 *
 * `pdfmake` rather than a headless browser. Puppeteer would give prettier
 * output — it is HTML and CSS — but it ships Chromium: ~300MB, hundreds of
 * megabytes of RAM per render, and seconds of start-up. Deployment is Render's
 * free tier, which already has 30–50 second cold starts (§15), so a browser per
 * PDF is the wrong trade. An invoice is a header, a table and a totals block,
 * which is precisely what a document-definition library does well, and it
 * handles page breaks across a long invoice for free.
 *
 * If the invoice ever becomes a designed, branded artifact, HTML and CSS are
 * far pleasanter than this and the decision is worth revisiting on a host with
 * room for Chromium.
 */

/**
 * The 14 fonts every PDF reader has built in, so nothing is embedded and no
 * font file has to be shipped or loaded.
 *
 * The cost is Helvetica rather than a brand typeface, and no Naira glyph — see
 * `money.ts` and the `NGN ` prefix used throughout these documents.
 */
const FONTS = {
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
};

const printer = new PdfPrinter(FONTS);

/** Renders a document definition to a single Buffer. */
export function renderPdf(definition: TDocumentDefinitions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = printer.createPdfKitDocument({
      defaultStyle: { font: 'Helvetica', fontSize: 9 },
      pageSize: 'A4',
      pageMargins: [40, 40, 40, 50],
      ...definition,
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/**
 * Money for print.
 *
 * Deliberately not `formatMinor`: the built-in fonts have no ₦ glyph, and a
 * missing glyph renders as a blank or a box on an invoice a customer is meant
 * to pay from. "NGN 2,500.00" is unambiguous everywhere.
 */
export function printMoney(minor: number, currency = 'NGN'): string {
  const major = (Math.abs(minor) / 100).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${minor < 0 ? '-' : ''}${currency} ${major}`;
}

/** A date a human reads, in the organization's timezone. */
export function printDate(value: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: timezone,
  }).format(value);
}

/** Drops the lines a business has not filled in, rather than printing blanks. */
export function presentLines(...lines: (string | null | undefined)[]): string {
  return lines.filter((line) => !!line && line.trim()).join('\n');
}
