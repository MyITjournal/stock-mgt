import { randomUUID } from 'node:crypto';
import { BarcodeSymbology, BusinessType } from '@prisma/client';
import { resolveBarcode } from './barcode';
import { generateSku } from './product.service';
import { chooseDefaultSellingUnit, defaultIsSellable } from './selling-units';

/**
 * Importing a catalog from a spreadsheet: the rules, with no database.
 *
 * ## One plan, two uses
 *
 * The preview and the save both call `planImport` on the same rows, so the
 * preview cannot promise a row the save then refuses. The save writes exactly
 * the plan the preview showed, re-derived against the catalog as it is at that
 * moment.
 *
 * ## The row
 *
 * One product per row: what it is counted in, and up to two bigger units with
 * how many of the counted-in unit each holds — a roll of 10 sachets, a carton
 * of 160. Every cell arrives as **text**, exactly as the spreadsheet stored
 * it, and is read here, so a browser never decides what a price means.
 *
 * ## What it deliberately does not do
 *
 * - **Update a product that already exists.** Same name, case aside, and the
 *   row is skipped with a reason. Changing prices in bulk belongs with export:
 *   download, edit, upload back.
 * - **Take a cost or opening stock.** Cost comes from deliveries (§2); opening
 *   stock is its own step, because it needs what was paid.
 * - **Ask about price lists.** Prices go on the default list. Shops here price
 *   the item, not the buyer.
 */

/** One spreadsheet row, every cell as the text the file holds. */
export interface ImportRowInput {
  /** The spreadsheet's own row number, for messages. */
  line?: number;
  name?: string;
  size?: string;
  category?: string;
  countedIn?: string;
  price?: string;
  unit2?: string;
  unit2Count?: string;
  unit2Price?: string;
  unit3?: string;
  unit3Count?: string;
  unit3Price?: string;
  barcode?: string;
}

/** What the catalog already holds, read once before planning. */
export interface ImportContext {
  /** Live product names, lower-cased. */
  existingNames: ReadonlySet<string>;
  /** Every SKU in use, deleted products included — the constraint sees them. */
  existingSkus: ReadonlySet<string>;
  /** Every barcode in use. */
  existingBarcodes: ReadonlySet<string>;
  /** Every category, deleted ones included, so a deleted name is revived. */
  categories: readonly { id: string; name: string; deleted: boolean }[];
  defaultTierId: string | null;
  businessType: BusinessType;
}

export interface PlannedUnit {
  id: string;
  name: string;
  factor: number;
  /** Its own price on the default list, in kobo. Null for none. */
  price: number | null;
  isBase: boolean;
  isSellable: boolean;
  isDefaultSelling: boolean;
}

export interface PlannedProduct {
  id: string;
  sku: string;
  name: string;
  size: string | null;
  /** The counted-in unit's price, which is what the form calls base price. */
  basePrice: number | null;
  category: { id: string; name: string; isNew: boolean } | null;
  units: PlannedUnit[];
  barcode: { code: string; symbology: BarcodeSymbology } | null;
}

export type RowStatus = 'add' | 'skip' | 'error';

export interface PlannedRow {
  line: number;
  name: string;
  status: RowStatus;
  /** Problems for `error`, the reason for `skip`, warnings for `add`. */
  messages: string[];
  product: PlannedProduct | null;
}

export interface ImportPlan {
  rows: PlannedRow[];
  /** Categories this import creates. */
  newCategories: { id: string; name: string }[];
  /** Deleted categories this import brings back. */
  revivedCategories: { id: string; name: string }[];
  adding: number;
  skipped: number;
  errors: number;
  defaultTierId: string | null;
}

/** The most rows one file may carry. */
export const MAX_IMPORT_ROWS = 2000;

const LIMITS = { name: 200, size: 40, unit: 40, category: 120 } as const;

export function planImport(
  inputs: readonly ImportRowInput[],
  context: ImportContext,
): ImportPlan {
  const rows: PlannedRow[] = [];
  const firstLineByName = new Map<string, number>();
  const firstLineByBarcode = new Map<string, number>();
  const usedSkus = new Set(context.existingSkus);

  // Categories resolve case-insensitively: "milk" in the file is the shop's
  // "Milk". A live one wins over a deleted one of the same name.
  const liveCategory = new Map<string, { id: string; name: string }>();
  const deletedCategory = new Map<string, { id: string; name: string }>();
  for (const row of context.categories) {
    (row.deleted ? deletedCategory : liveCategory).set(row.name.toLowerCase(), {
      id: row.id,
      name: row.name,
    });
  }
  const newCategories = new Map<string, { id: string; name: string }>();
  const revived = new Map<string, { id: string; name: string }>();

  inputs.forEach((input, index) => {
    const cells = trimAll(input);
    if (isBlank(cells)) return;

    const line = input.line ?? index + 2;
    const name = cells.name;
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!name) {
      rows.push(errorRow(line, '', ['There is no name.']));
      return;
    }
    if (name.length > LIMITS.name) {
      errors.push(`The name is longer than ${LIMITS.name} characters.`);
    }

    const key = name.toLowerCase();
    if (context.existingNames.has(key)) {
      rows.push({
        line,
        name,
        status: 'skip',
        messages: ['Already in your products, so it is left as it is.'],
        product: null,
      });
      return;
    }
    const earlier = firstLineByName.get(key);
    if (earlier !== undefined) {
      rows.push(
        errorRow(line, name, [
          `Same name as row ${earlier}. Each product goes in once.`,
        ]),
      );
      return;
    }
    firstLineByName.set(key, line);

    if (cells.size.length > LIMITS.size) {
      errors.push(`The size is longer than ${LIMITS.size} characters.`);
    }

    // ── Units ──────────────────────────────────────────────────────────────
    // Blank "Counted in" is a piece: the commonest answer, and one fewer
    // thing to fill in for a shop that sells everything singly.
    const baseName = cells.countedIn || 'piece';
    const basePrice = readPrice(cells.price, baseName, errors);
    const drafts: { name: string; factor: number; price: number | null }[] = [
      { name: baseName, factor: 1, price: null },
    ];

    for (const slot of [
      {
        name: cells.unit2,
        count: cells.unit2Count,
        price: cells.unit2Price,
        label: 'Unit 2',
      },
      {
        name: cells.unit3,
        count: cells.unit3Count,
        price: cells.unit3Price,
        label: 'Unit 3',
      },
    ]) {
      if (!slot.name) {
        if (slot.count || slot.price) {
          errors.push(
            `${slot.label} has a number but no name. Say what it is — roll, carton, 1/2 carton.`,
          );
        }
        continue;
      }
      const factor = readCount(slot.count, slot.name, baseName, errors);
      const price = readPrice(slot.price, slot.name, errors);
      if (factor !== null) drafts.push({ name: slot.name, factor, price });
    }

    const unitNames = drafts.map((unit) => unit.name.toLowerCase());
    if (new Set(unitNames).size !== unitNames.length) {
      errors.push('Two units have the same name. Give each its own.');
    }
    for (const unit of drafts) {
      if (unit.name.length > LIMITS.unit) {
        errors.push(`"${unit.name}" is longer than ${LIMITS.unit} characters.`);
      }
    }

    // ── Category ───────────────────────────────────────────────────────────
    let category: PlannedProduct['category'] = null;
    if (cells.category) {
      const categoryKey = cells.category.toLowerCase();
      if (cells.category.length > LIMITS.category) {
        errors.push(
          `The category is longer than ${LIMITS.category} characters.`,
        );
      } else if (liveCategory.has(categoryKey)) {
        category = { ...liveCategory.get(categoryKey)!, isNew: false };
      } else if (deletedCategory.has(categoryKey)) {
        const found = deletedCategory.get(categoryKey)!;
        category = { ...found, isNew: true };
        revived.set(categoryKey, found);
      } else {
        const planned = newCategories.get(categoryKey) ?? {
          id: randomUUID(),
          name: cells.category,
        };
        newCategories.set(categoryKey, planned);
        category = { ...planned, isNew: true };
      }
    }

    // ── Barcode ────────────────────────────────────────────────────────────
    let barcode: PlannedProduct['barcode'] = null;
    if (/^\d+(\.\d+)?e\+?\d+$/i.test(cells.barcode)) {
      // A spreadsheet stores a long code as a number and shows it as
      // 6.154E+12; saved as .csv, that rounded form is all that is written,
      // and the digits are gone. Said for what it is, not as a bad check digit.
      errors.push(
        `The barcode reads ${cells.barcode}: the spreadsheet turned it into a rounded number and its digits are lost. Format the Barcode column as Text, type the codes again, and save as .xlsx.`,
      );
    } else if (cells.barcode) {
      const resolved = resolveBarcode({ code: cells.barcode });
      if ('error' in resolved) {
        errors.push(resolved.error);
      } else if (context.existingBarcodes.has(resolved.code)) {
        errors.push(
          `The barcode ${resolved.code} is already on another of your products.`,
        );
      } else if (firstLineByBarcode.has(resolved.code)) {
        errors.push(
          `Same barcode as row ${firstLineByBarcode.get(resolved.code)}.`,
        );
      } else {
        firstLineByBarcode.set(resolved.code, line);
        barcode = resolved;
      }
    }

    const tierPrices = drafts.some((unit) => unit.price !== null);
    if (tierPrices && !context.defaultTierId) {
      errors.push(
        'Your shop has no default price list, so these prices have nowhere to go.',
      );
    }

    if (errors.length > 0) {
      rows.push(errorRow(line, name, errors));
      return;
    }

    // ── Selling, exactly as the product form decides it ──────────────────────
    const units: PlannedUnit[] = drafts.map((unit) => ({
      id: randomUUID(),
      name: unit.name,
      factor: unit.factor,
      price: unit.price,
      isBase: unit.factor === 1,
      isSellable: defaultIsSellable(unit, drafts.length, context.businessType),
      isDefaultSelling: false,
    }));
    const defaultId = chooseDefaultSellingUnit(
      units,
      undefined,
      context.businessType,
    );
    for (const unit of units) unit.isDefaultSelling = unit.id === defaultId;

    // What the till will do with each unit sold, said before it happens.
    for (const unit of units) {
      if (!unit.isSellable) continue;
      const own = unit.isBase ? basePrice : unit.price;
      if (own !== null) continue;
      if (basePrice === null) {
        warnings.push(
          `No price for the ${unit.name}, so the till will not sell it until one is set.`,
        );
      } else {
        warnings.push(
          `No price of its own for the ${unit.name}, so it will be charged ${unit.factor} × the ${baseName} price.`,
        );
      }
    }

    rows.push({
      line,
      name,
      status: 'add',
      messages: warnings,
      product: {
        id: randomUUID(),
        sku: uniqueSku(name, usedSkus),
        name,
        size: cells.size || null,
        basePrice,
        category,
        units,
        barcode,
      },
    });
  });

  return {
    rows,
    newCategories: [...newCategories.values()],
    revivedCategories: [...revived.values()],
    adding: rows.filter((row) => row.status === 'add').length,
    skipped: rows.filter((row) => row.status === 'skip').length,
    errors: rows.filter((row) => row.status === 'error').length,
    defaultTierId: context.defaultTierId,
  };
}

/**
 * Naira as written in a spreadsheet, to kobo. Exact: the text is read as a
 * decimal and never passes through a floating-point number.
 *
 * Takes `14500`, `14,500`, `14,500.50`, `₦14,500`, `N14,500`, `NGN 14500` and
 * the exponent form a spreadsheet file sometimes stores (`1.45E+4`). More than
 * two decimals is rounded to the kobo, half up — that is what the cell showed
 * the person, when a formula left `14500.499999999998` behind it.
 */
export function parseNaira(raw: string): { kobo: number } | { error: string } {
  const text = raw
    .trim()
    .replace(/^(₦|NGN|N)\s*/i, '')
    .replace(/[,\s]/g, '');
  const match = /^(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!text || !match || (!match[1] && !match[2])) {
    return { error: `"${raw.trim()}" is not an amount in naira.` };
  }

  let whole = match[1] || '0';
  let fraction = match[2] ?? '';
  const exponent = match[3] ? Number(match[3]) : 0;
  if (exponent > 0) {
    const moved = fraction.padEnd(exponent, '0');
    whole += moved.slice(0, exponent);
    fraction = moved.slice(exponent);
  } else if (exponent < 0) {
    const padded = whole.padStart(-exponent + 1, '0');
    fraction = padded.slice(exponent) + fraction;
    whole = padded.slice(0, exponent);
  }

  const kobo = Number(fraction.padEnd(2, '0').slice(0, 2));
  const roundUp = Number(fraction[2] ?? '0') >= 5 ? 1 : 0;
  const total = Number(whole) * 100 + kobo + roundUp;
  if (!Number.isSafeInteger(total)) {
    return { error: `"${raw.trim()}" is too large to be a price.` };
  }
  return { kobo: total };
}

function readPrice(
  raw: string,
  unitName: string,
  errors: string[],
): number | null {
  if (!raw) return null;
  const parsed = parseNaira(raw);
  if ('error' in parsed) {
    errors.push(`Price for ${unitName}: ${parsed.error}`);
    return null;
  }
  return parsed.kobo;
}

/**
 * How many of the counted-in unit a bigger one holds. A whole number of two
 * or more: one would make it a second base unit, and a fraction has no
 * meaning in a ledger counted in whole pieces.
 */
function readCount(
  raw: string,
  unitName: string,
  baseName: string,
  errors: string[],
): number | null {
  if (!raw) {
    errors.push(`How many ${baseName} in a ${unitName}? That column is empty.`);
    return null;
  }
  const match = /^(\d+)(?:\.0+)?$/.exec(raw.replace(/[,\s]/g, ''));
  const count = match ? Number(match[1]) : NaN;
  if (!Number.isSafeInteger(count) || count < 2) {
    errors.push(
      `How many ${baseName} in a ${unitName} must be a whole number of 2 or more, not "${raw}".`,
    );
    return null;
  }
  return count;
}

/** The generated SKU, made unique against the shop and the rest of the file. */
function uniqueSku(name: string, used: Set<string>): string {
  const base = generateSku(name);
  let sku = base;
  for (let n = 2; used.has(sku); n++) sku = `${base}-${n}`;
  used.add(sku);
  return sku;
}

type Cells = Required<Omit<ImportRowInput, 'line'>>;

function trimAll(input: ImportRowInput): Cells {
  const cell = (value: string | undefined) => (value ?? '').trim();
  return {
    name: cell(input.name),
    size: cell(input.size),
    category: cell(input.category),
    countedIn: cell(input.countedIn),
    price: cell(input.price),
    unit2: cell(input.unit2),
    unit2Count: cell(input.unit2Count),
    unit2Price: cell(input.unit2Price),
    unit3: cell(input.unit3),
    unit3Count: cell(input.unit3Count),
    unit3Price: cell(input.unit3Price),
    barcode: cell(input.barcode),
  };
}

function isBlank(cells: Cells): boolean {
  return Object.values(cells).every((value) => value === '');
}

function errorRow(line: number, name: string, messages: string[]): PlannedRow {
  return { line, name, status: 'error', messages, product: null };
}
