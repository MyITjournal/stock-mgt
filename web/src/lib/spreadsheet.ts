import type { components } from '../api/schema';

export type ImportRow = components['schemas']['ImportRowDto'];
type ImportField = Exclude<keyof ImportRow, 'line'>;

/**
 * Reading a product spreadsheet into rows for `POST /products/import`.
 *
 * ## The browser reads cells, the server reads meaning
 *
 * Every cell goes up as the **text the file holds** — a price as `14,500`, a
 * count as `10` — and the server decides what it means. So the preview and the
 * save read a row identically, and no price passes through a JavaScript
 * number on the way. For `.xlsx`, `parseNumber` hands back the number exactly
 * as stored in the file rather than as a float.
 *
 * ## Columns are found by name, not position
 *
 * A person reorders columns, adds one of their own for notes, or types
 * "counted in" in lower case. Headers are matched loosely, extra columns are
 * ignored and reported, and only a missing Name column refuses the file.
 */

/** The template's columns, in its order, with the names a header may use. */
export const COLUMNS: readonly {
  field: ImportField;
  header: string;
  aliases: readonly string[];
  hint: string;
}[] = [
  {
    field: 'name',
    header: 'Name',
    aliases: ['product', 'productname', 'item'],
    hint: 'Required. A name already in your products is skipped.',
  },
  {
    field: 'size',
    header: 'Size',
    aliases: [],
    hint: 'Plain text — 14g, 50cl, 1L.',
  },
  {
    field: 'category',
    header: 'Category',
    aliases: [],
    hint: 'By name. A new one is created.',
  },
  {
    field: 'countedIn',
    header: 'Counted in',
    aliases: ['baseunit', 'unit', 'unit1'],
    hint: 'What you count stock in. Blank means piece.',
  },
  {
    field: 'price',
    header: 'Price',
    aliases: ['countedinprice', 'unit1price'],
    hint: 'For one of those, in naira, VAT included.',
  },
  {
    field: 'unit2',
    header: 'Unit 2',
    aliases: [],
    hint: 'A bigger unit — roll, carton, 1/2 carton.',
  },
  {
    field: 'unit2Count',
    header: 'Unit 2 how many',
    aliases: ['unit2count', 'unit2holds', 'howmanyinunit2'],
    hint: 'How many "counted in" it holds.',
  },
  {
    field: 'unit2Price',
    header: 'Unit 2 price',
    aliases: [],
    hint: 'In naira.',
  },
  {
    field: 'unit3',
    header: 'Unit 3',
    aliases: [],
    hint: 'Another, if there is one.',
  },
  {
    field: 'unit3Count',
    header: 'Unit 3 how many',
    aliases: ['unit3count', 'unit3holds', 'howmanyinunit3'],
    hint: '',
  },
  { field: 'unit3Price', header: 'Unit 3 price', aliases: [], hint: '' },
  {
    field: 'barcode',
    header: 'Barcode',
    aliases: ['ean', 'code'],
    hint: 'For the counted-in unit. Format the column as Text first.',
  },
];

const EXAMPLES: readonly (readonly string[])[] = [
  [
    'Peak 14g',
    '14g',
    'Milk',
    'sachet',
    '100',
    'roll',
    '10',
    '950',
    'carton',
    '160',
    '14,500',
    '',
  ],
  [
    'Indomie 70g',
    '70g',
    'Noodles',
    'piece',
    '250',
    'carton',
    '40',
    '9,600',
    '',
    '',
    '',
    '',
  ],
];

/** The template as a .csv, with two example rows to overwrite. */
export function downloadTemplate(): void {
  const lines = [COLUMNS.map((column) => column.header), ...EXAMPLES].map(
    (cells) => cells.map(csvCell).join(','),
  );
  // The byte-order mark makes Excel read the file as UTF-8.
  const blob = new Blob(
    [String.fromCharCode(0xfeff) + lines.join('\r\n') + '\r\n'],
    {
      type: 'text/csv;charset=utf-8',
    },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'reho-products-template.csv';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export interface ReadResult {
  rows: ImportRow[];
  /** Headers in the file that match no column — said, then ignored. */
  ignored: string[];
}

/** Reads an .xlsx or .csv into rows. Throws an Error with a readable message. */
export async function readSpreadsheet(file: File): Promise<ReadResult> {
  const name = file.name.toLowerCase();
  let grid: string[][];
  if (name.endsWith('.xlsx')) {
    grid = await readXlsx(file);
  } else if (name.endsWith('.csv') || name.endsWith('.txt')) {
    grid = await readCsv(file);
  } else if (name.endsWith('.xls')) {
    throw new Error(
      'That is the old Excel format. Open it in Excel and use Save As → Excel Workbook (.xlsx), then upload that.',
    );
  } else {
    throw new Error('Upload an Excel workbook (.xlsx) or a .csv file.');
  }
  return toRows(grid);
}

async function readXlsx(file: File): Promise<string[][]> {
  // Loaded on first use: most visits to the dashboard never import anything.
  const { readSheet } = await import('read-excel-file/browser');
  try {
    const data = await readSheet(file, { parseNumber: (raw: string) => raw });
    return data.map((row) => row.map(cellText));
  } catch {
    throw new Error(
      'Could not read that workbook. Check it opens in Excel, and that the products are on the first sheet.',
    );
  }
}

async function readCsv(file: File): Promise<string[][]> {
  const { default: Papa } = await import('papaparse');
  const text = await file.text();
  const clean = text.replace(/^\uFEFF/, '');
  // The separator is picked from the header row, which holds no amounts. Asked
  // to guess from the whole file, a parser sees the comma in "14,500" and
  // misreads a file saved with semicolons, as some spreadsheets do.
  const header = clean.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [',', ';', '\t'].reduce((best, candidate) =>
    header.split(candidate).length > header.split(best).length
      ? candidate
      : best,
  );
  const parsed = Papa.parse<string[]>(clean, {
    delimiter,
    skipEmptyLines: false,
  });
  return parsed.data;
}

function cellText(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return '';
  return String(cell);
}

function toRows(grid: string[][]): ReadResult {
  // The header is the first row with anything in it. Line numbers stay those
  // of the spreadsheet, so a message about "row 14" is row 14 on screen.
  const headerIndex = grid.findIndex((row) =>
    row.some((cell) => cell.trim() !== ''),
  );
  if (headerIndex === -1) throw new Error('That file is empty.');

  const fieldAt = new Map<number, ImportField>();
  const ignored: string[] = [];
  grid[headerIndex].forEach((header, index) => {
    const key = normalise(header);
    if (!key) return;
    const column = COLUMNS.find(
      (candidate) =>
        normalise(candidate.header) === key || candidate.aliases.includes(key),
    );
    if (column && ![...fieldAt.values()].includes(column.field)) {
      fieldAt.set(index, column.field);
    } else {
      ignored.push(header.trim());
    }
  });

  if (![...fieldAt.values()].includes('name')) {
    throw new Error(
      'The first row should be the column names from the template — Name, Size, Category, Counted in, Price and so on. Download the template and copy your products into it.',
    );
  }

  const rows: ImportRow[] = [];
  for (let index = headerIndex + 1; index < grid.length; index++) {
    const row: ImportRow = { line: index + 1 };
    let any = false;
    fieldAt.forEach((field, column) => {
      const value = (grid[index][column] ?? '').trim();
      if (value) {
        row[field] = value;
        any = true;
      }
    });
    if (any) rows.push(row);
  }
  return { rows, ignored };
}

function normalise(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
