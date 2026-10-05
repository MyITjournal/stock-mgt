/**
 * Saving what a screen shows as an Excel file.
 *
 * ## Light on purpose
 *
 * The writer is imported on the first download, never with the page, so a
 * screen with a Download button opens exactly as fast as one without. And a
 * download asks nothing new of the server: each screen hands over the rows it
 * already read, or reads the same endpoint it already reads.
 *
 * ## The same figures as the screen
 *
 * Nothing is worked out here. A money value is the server's kobo shown in
 * naira — the same conversion `<Money>` does for the screen — so the file and
 * the screen cannot disagree. A value the server left out (cost, for a role
 * that may not see it) is an empty cell, never a zero: a zero reads as free
 * goods to anyone who sums the column.
 *
 * Barcodes and SKUs are written as **text**, so Excel cannot turn
 * `6154000000005` into `6.154E+12` or drop the leading zero of a UPC.
 */

export type SheetKind = 'text' | 'number' | 'money' | 'date' | 'percent';

export interface SheetColumn<Row> {
  header: string;
  /** Money in kobo; a percentage in basis points; a date as an ISO string. */
  value: (row: Row) => string | number | Date | null | undefined;
  kind?: SheetKind;
  /** In characters. */
  width?: number;
}

/** One tab of a workbook: a table, under a name. */
export interface SheetTab<Row> {
  name: string;
  columns: readonly SheetColumn<Row>[];
  rows: readonly Row[];
}

/** One table, one tab. */
export function downloadSheet<Row>(
  fileName: string,
  columns: readonly SheetColumn<Row>[],
  rows: readonly Row[],
): Promise<void> {
  return downloadWorkbook(fileName, [tab('Sheet1', columns, rows)]);
}

/**
 * Several tables in one file, a tab each — a report that groups the same
 * figures three ways (by vendor, by category, by product) is one download.
 */
export async function downloadWorkbook(
  fileName: string,
  // Each tab has its own row type; `never` lets them sit in one list.
  tabs: readonly SheetTab<never>[],
): Promise<void> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');

  await writeXlsxFile(
    tabs.map((tab) => ({
      // Excel caps a tab name at 31 characters.
      sheet: tab.name.slice(0, 31),
      data: [
        tab.columns.map((column) => ({
          value: column.header,
          fontWeight: 'bold' as const,
        })),
        ...tab.rows.map((row) =>
          tab.columns.map((column) =>
            cell(column.kind ?? 'text', column.value(row)),
          ),
        ),
      ],
      columns: tab.columns.map((column) => ({
        width: column.width ?? defaultWidth(column.kind ?? 'text'),
      })),
      stickyRowsCount: 1,
    })),
  ).toFile(`${fileName}.xlsx`);
}

/** A tab, typed for its rows and widened to sit beside the others. */
export function tab<Row>(
  name: string,
  columns: readonly SheetColumn<Row>[],
  rows: readonly Row[],
): SheetTab<never> {
  return { name, columns, rows } as unknown as SheetTab<never>;
}

function cell(kind: SheetKind, raw: string | number | Date | null | undefined) {
  if (raw === null || raw === undefined || raw === '') return null;
  switch (kind) {
    case 'money':
      // Kobo shown as naira, exactly as <Money> shows it on screen.
      return typeof raw === 'number'
        ? { value: raw / 100, type: Number, format: '#,##0.00' }
        : null;
    case 'percent':
      // Basis points shown as a percentage, as the screen shows a margin.
      return typeof raw === 'number'
        ? { value: raw / 10_000, type: Number, format: '0.0%' }
        : null;
    case 'number':
      return typeof raw === 'number' ? { value: raw, type: Number } : null;
    case 'date': {
      const date = raw instanceof Date ? raw : new Date(raw);
      return Number.isNaN(date.getTime())
        ? null
        : { value: date, type: Date, format: 'dd/mm/yyyy' };
    }
    default:
      return { value: String(raw), type: String };
  }
}

function defaultWidth(kind: SheetKind): number {
  return kind === 'text' ? 24 : kind === 'date' ? 12 : 14;
}

/** Today, for a file name: `products-2026-10-05`. */
export function stamp(name: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${name}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Every page of a cursor-paged feed, for a download of the whole list.
 *
 * The screen shows fifty at a time; a file wants all of them. Asked only when
 * somebody presses Download, a few large pages at a time.
 */
export async function allPages<Item>(
  fetchPage: (
    cursor: string | null,
  ) => Promise<{ items: Item[]; nextCursor: string | null }>,
): Promise<Item[]> {
  const items: Item[] = [];
  let cursor: string | null = null;
  // A ceiling, so a feed that never ends cannot hang the button.
  for (let page = 0; page < 100; page++) {
    const result = await fetchPage(cursor);
    items.push(...result.items);
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }
  return items;
}
