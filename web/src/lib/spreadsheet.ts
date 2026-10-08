import type { components } from '../api/schema';

export type ImportRow = components['schemas']['ImportRowDto'];
type ImportUnit = components['schemas']['ImportUnitDto'];
type FixedField =
  | 'name'
  | 'size'
  | 'category'
  | 'countedIn'
  | 'price'
  | 'barcode'
  | 'optionType'
  | 'option';

/**
 * Reading a product spreadsheet into rows for `POST /products/import`.
 *
 * ## The browser reads cells, the server reads meaning
 *
 * Every cell goes up as the **text the file holds** — a price as `14,500`, a
 * count as `12` — and the server decides what it means, including what a
 * "1/2 carton" holds and which units the till sells. So the preview and the
 * save read a row identically, and no price passes through a JavaScript
 * number on the way. For `.xlsx`, `parseNumber` hands back the number exactly
 * as stored in the file rather than as a float.
 *
 * ## Columns are found by name, not position
 *
 * A person reorders columns, adds one of their own for notes, or types
 * "counted in" in lower case. Headers are matched loosely, extra columns are
 * ignored and reported, and only a missing Name column refuses the file.
 * **Unit columns are read however many there are** — Unit 2, Unit 3, Unit 4 …
 * each with "how many" and "price" — because the export writes as many as a
 * product has, and a file that went out must be able to come back in.
 */

/** The fixed columns, with the names a header may use. */
export const FIXED_COLUMNS: readonly {
  field: FixedField;
  header: string;
  aliases: readonly string[];
}[] = [
  {
    field: 'name',
    header: 'Name',
    aliases: ['product', 'productname', 'item'],
  },
  { field: 'size', header: 'Size', aliases: [] },
  { field: 'category', header: 'Category', aliases: [] },
  {
    field: 'countedIn',
    header: 'Counted in',
    aliases: ['baseunit', 'unit', 'unit1'],
  },
  {
    field: 'price',
    header: 'Price',
    aliases: ['countedinprice', 'unit1price'],
  },
  { field: 'barcode', header: 'Barcode', aliases: ['ean', 'code'] },
  {
    field: 'optionType',
    header: 'Option type',
    aliases: ['optiontypes', 'varianttype', 'attribute', 'attributes'],
  },
  { field: 'option', header: 'Option', aliases: ['variant', 'options'] },
];

/** The header of one fixed column, for the export to write. */
export function headerOf(field: FixedField): string {
  return FIXED_COLUMNS.find((column) => column.field === field)!.header;
}

/** The three headers of bigger unit `n` (2, 3, …). */
export function unitHeaders(n: number) {
  return {
    name: `Unit ${n}`,
    count: `Unit ${n} how many`,
    price: `Unit ${n} price`,
  };
}

/** What each column means, for the import screen. */
export const COLUMN_HELP: readonly { header: string; hint: string }[] = [
  {
    header: 'Name',
    hint: 'Required. A name already in your products is skipped.',
  },
  { header: 'Size', hint: 'Plain text — 14g, 50cl, 400ml.' },
  { header: 'Category', hint: 'By name. A new one is created.' },
  { header: 'Counted in', hint: 'What you count stock in. Blank means piece.' },
  { header: 'Price', hint: 'For one of those, in naira, VAT included.' },
  {
    header: 'Unit 2, 3, 4 …',
    hint: 'Each bigger unit: pack, carton, 1/2 carton. Add more columns as you need.',
  },
  {
    header: '… how many',
    hint: 'How many "counted in" it holds. Leave empty for a portion like 1/2 carton.',
  },
  {
    header: '… price',
    hint: 'In naira. A unit with a price is sold at the till; one without is counted only.',
  },
  {
    header: 'Barcode',
    hint: 'For the counted-in unit. Format the column as Text first.',
  },
  {
    header: 'Option type',
    hint: 'Only for a product with options: what they differ by — Flavour, or Flavour / Pack size.',
  },
  {
    header: 'Option',
    hint: 'One row per option, same name and size: Chicken, Onion. Leave units blank after the first row; a different price is that option’s own.',
  },
];

/** How many bigger-unit slots the template starts with. */
const TEMPLATE_UNITS = 4;

/**
 * The template's examples are real shapes from a shop: a lotion sold only in
 * parts of its carton, a roll-on sold by the pack and the carton and halves of
 * each, and a carton of noodles sold whole and by the piece — in two flavours,
 * the second filling in only its option (§24).
 */
const EXAMPLES: readonly {
  fixed: Partial<Record<FixedField, string>>;
  units: readonly [string, string, string][];
}[] = [
  {
    fixed: {
      name: 'Even Glow 400ml',
      size: '400ml',
      category: 'Lotion',
      countedIn: 'piece',
    },
    units: [
      ['carton', '12', ''],
      ['1/2 carton', '', '29,900'],
      ['1/4 carton', '', '14,950'],
    ],
  },
  {
    fixed: {
      name: 'Dry Impact 50ml',
      size: '50ml',
      category: 'Roll on',
      countedIn: 'piece',
    },
    units: [
      ['pack', '6', '9,700'],
      ['1/2 pack', '', '4,850'],
      ['carton', '30', '48,500'],
      ['1/2 carton', '', '24,250'],
    ],
  },
  {
    fixed: {
      name: 'Indomie 70g',
      size: '70g',
      category: 'Noodles',
      countedIn: 'piece',
      price: '250',
      optionType: 'Flavour',
      option: 'Chicken',
    },
    units: [['carton', '40', '9,600']],
  },
  {
    fixed: {
      name: 'Indomie 70g',
      size: '70g',
      option: 'Onion Chicken',
    },
    units: [],
  },
];

/** The template as a .csv, with example rows to overwrite. */
export function downloadTemplate(): void {
  const slots = Array.from({ length: TEMPLATE_UNITS }, (_, i) => i + 2);
  const header = [
    ...['name', 'size', 'category', 'countedIn', 'price'].map((field) =>
      headerOf(field as FixedField),
    ),
    ...slots.flatMap((n) => Object.values(unitHeaders(n))),
    headerOf('barcode'),
    headerOf('optionType'),
    headerOf('option'),
  ];
  const rows = EXAMPLES.map((example) => [
    ...(['name', 'size', 'category', 'countedIn', 'price'] as const).map(
      (field) => example.fixed[field] ?? '',
    ),
    ...slots.flatMap((_, i) => example.units[i] ?? ['', '', '']),
    example.fixed.barcode ?? '',
    example.fixed.optionType ?? '',
    example.fixed.option ?? '',
  ]);
  const lines = [header, ...rows].map((cells) => cells.map(csvCell).join(','));
  // The byte-order mark makes Excel read the file as UTF-8.
  const blob = new Blob(
    [String.fromCharCode(0xfeff) + lines.join('\r\n') + '\r\n'],
    { type: 'text/csv;charset=utf-8' },
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
  // A byte-order mark at the start is Excel's, not part of the first header.
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
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

/** Where a header points: a fixed field, or one part of bigger unit `n`. */
type Target =
  | { kind: 'fixed'; field: FixedField }
  | { kind: 'unit'; n: number; part: keyof ImportUnit };

function targetOf(header: string): Target | null {
  const key = normalise(header);
  if (!key) return null;
  const fixed = FIXED_COLUMNS.find(
    (column) =>
      normalise(column.header) === key || column.aliases.includes(key),
  );
  if (fixed) return { kind: 'fixed', field: fixed.field };

  const unit = /^unit(\d+)(howmany|howm|count|holds|price)?$/.exec(key);
  if (unit && Number(unit[1]) >= 2) {
    const part: keyof ImportUnit = !unit[2]
      ? 'name'
      : unit[2] === 'price'
        ? 'price'
        : 'count';
    return { kind: 'unit', n: Number(unit[1]), part };
  }
  const inUnit = /^howmanyinunit(\d+)$/.exec(key);
  if (inUnit && Number(inUnit[1]) >= 2) {
    return { kind: 'unit', n: Number(inUnit[1]), part: 'count' };
  }
  return null;
}

function toRows(grid: string[][]): ReadResult {
  // The header is the first row with anything in it. Line numbers stay those
  // of the spreadsheet, so a message about "row 14" is row 14 on screen.
  const headerIndex = grid.findIndex((row) =>
    row.some((cell) => cell.trim() !== ''),
  );
  if (headerIndex === -1) throw new Error('That file is empty.');

  const targets = new Map<number, Target>();
  const seen = new Set<string>();
  const ignored: string[] = [];
  grid[headerIndex].forEach((header, index) => {
    const target = targetOf(header);
    const id = target
      ? target.kind === 'fixed'
        ? target.field
        : `${target.n}:${target.part}`
      : null;
    if (target && id && !seen.has(id)) {
      seen.add(id);
      targets.set(index, target);
    } else if (header.trim()) {
      ignored.push(header.trim());
    }
  });

  if (!seen.has('name')) {
    throw new Error(
      'The first row should be the column names from the template — Name, Size, Category, Counted in, Price and so on. Download the template and copy your products into it.',
    );
  }

  const rows: ImportRow[] = [];
  for (let index = headerIndex + 1; index < grid.length; index++) {
    const row: ImportRow = { line: index + 1 };
    const units = new Map<number, ImportUnit>();
    let any = false;
    targets.forEach((target, column) => {
      const value = (grid[index][column] ?? '').trim();
      if (!value) return;
      any = true;
      if (target.kind === 'fixed') {
        row[target.field] = value;
      } else {
        const unit = units.get(target.n) ?? {};
        unit[target.part] = value;
        units.set(target.n, unit);
      }
    });
    if (!any) continue;
    // In column order — Unit 2, Unit 3, … — so a message about "Unit 4"
    // means the fourth unit column the person filled in.
    const slots = [...units.keys()].sort((a, b) => a - b);
    if (slots.length > 0) {
      const last = slots[slots.length - 1];
      row.units = Array.from(
        { length: last - 1 },
        (_, i) => units.get(i + 2) ?? {},
      );
    }
    rows.push(row);
  }
  return { rows, ignored };
}

function normalise(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
