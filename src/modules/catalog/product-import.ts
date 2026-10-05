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
 * One product per row: what it is counted in, then as many bigger units as
 * the row has (Unit 2, Unit 3, …) with how many of the counted-in unit each
 * holds — a pack of 6 pieces, a carton of 30. Every cell arrives as **text**,
 * exactly as the spreadsheet stored it, and is read here, so a browser never
 * decides what a price means.
 *
 * ## Portions, and what the till sells
 *
 * A unit named like **"1/2 carton"** is a portion of another unit in the same
 * row, and its "how many" may be left empty: it is worked out from the carton,
 * exactly as *Add a portion* does on the product form, and refused when it is
 * not whole (½ of a carton of 15 is 7½ pieces).
 *
 * **A unit with a price is sold at the till; one without is counted but not
 * sold.** That is the spreadsheet's way of saying what the form's "Sold at the
 * till" box says, so there is no column for it — a lotion carton of 12 sold
 * only as 1/2 and 1/4 is a carton with no price beside two portions with
 * prices. A row with no prices at all falls back to the form's defaults.
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
  /** Unit 2, Unit 3, … in the order the columns came. */
  units?: ImportUnitInput[];
  barcode?: string;
}

export interface ImportUnitInput {
  name?: string;
  /** How many of the counted-in unit it holds. May be empty for a portion. */
  count?: string;
  price?: string;
}

/** The most units one row may carry beyond the counted-in one. */
export const MAX_IMPORT_UNITS = 12;

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
    // Portions whose size comes from another unit in the row, settled once
    // every named unit is known — "1/2 carton" may come before the carton.
    const portions: {
      name: string;
      price: number | null;
      count: number | null;
      of: Portion;
    }[] = [];

    cells.units.forEach((slot, index) => {
      const label = `Unit ${index + 2}`;
      if (!slot.name) {
        if (slot.count || slot.price) {
          errors.push(
            `${label} has a number but no name. Say what it is — pack, carton, 1/2 carton.`,
          );
        }
        return;
      }
      const price = readPrice(slot.price, slot.name, errors);
      const of = readPortion(slot.name);
      if (of) {
        const count = slot.count
          ? readCount(slot.count, slot.name, baseName, errors)
          : null;
        if (!slot.count || count !== null) {
          portions.push({ name: slot.name, price, count, of });
        }
        return;
      }
      const factor = readCount(slot.count, slot.name, baseName, errors);
      if (factor !== null) drafts.push({ name: slot.name, factor, price });
    });

    for (const portion of portions) {
      const whole = drafts.find(
        (unit) => unit.name.toLowerCase() === portion.of.unit.toLowerCase(),
      );
      if (!whole) {
        if (portion.count !== null) {
          // Sized by hand, so it stands without the unit it is part of.
          drafts.push({
            name: portion.name,
            factor: portion.count,
            price: portion.price,
          });
        } else {
          errors.push(
            `"${portion.name}" is part of a ${portion.of.unit}, but there is no ${portion.of.unit} in this row. Add the ${portion.of.unit} as a unit with how many ${baseName} it holds.`,
          );
        }
        continue;
      }
      const exact =
        (whole.factor * portion.of.numerator) / portion.of.denominator;
      if (!Number.isInteger(exact)) {
        errors.push(
          `"${portion.name}" is not a whole number of ${baseName}: a ${whole.name} holds ${whole.factor}, and ${portion.of.numerator}/${portion.of.denominator} of that is ${exact.toFixed(2).replace(/\.?0+$/, '')}.`,
        );
        continue;
      }
      if (exact < 2) {
        errors.push(
          `"${portion.name}" is a single ${baseName}. Sell the ${baseName} itself rather than a portion.`,
        );
        continue;
      }
      if (portion.count !== null && portion.count !== exact) {
        errors.push(
          `"${portion.name}" is ${exact} ${baseName}, not ${portion.count}. Leave its "how many" empty and it is worked out.`,
        );
        continue;
      }
      drafts.push({ name: portion.name, factor: exact, price: portion.price });
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

    // ── Selling ──────────────────────────────────────────────────────────────
    // A priced unit is sold and an unpriced one is counted only. With no price
    // anywhere in the row there is nothing to go on, so the form's defaults
    // decide — the same answer a product typed in would get.
    const priceOf = (unit: { factor: number; price: number | null }) =>
      unit.factor === 1 ? basePrice : unit.price;
    const anyPriced = drafts.some((unit) => priceOf(unit) !== null);
    const units: PlannedUnit[] = drafts.map((unit) => ({
      id: randomUUID(),
      name: unit.name,
      factor: unit.factor,
      price: unit.price,
      isBase: unit.factor === 1,
      isSellable: anyPriced
        ? priceOf(unit) !== null
        : defaultIsSellable(unit, drafts.length, context.businessType),
      isDefaultSelling: false,
    }));
    const defaultId = chooseDefaultSellingUnit(
      units,
      undefined,
      context.businessType,
    );
    for (const unit of units) unit.isDefaultSelling = unit.id === defaultId;

    // Said before it happens: with no prices the till cannot sell it at all.
    if (!anyPriced) {
      warnings.push(
        'No prices in this row, so the till will not sell it until one is set on the product.',
      );
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

interface Cells {
  name: string;
  size: string;
  category: string;
  countedIn: string;
  price: string;
  units: { name: string; count: string; price: string }[];
  barcode: string;
}

function trimAll(input: ImportRowInput): Cells {
  const cell = (value: string | undefined) => (value ?? '').trim();
  return {
    name: cell(input.name),
    size: cell(input.size),
    category: cell(input.category),
    countedIn: cell(input.countedIn),
    price: cell(input.price),
    units: (input.units ?? []).map((unit) => ({
      name: cell(unit.name),
      count: cell(unit.count),
      price: cell(unit.price),
    })),
    barcode: cell(input.barcode),
  };
}

function isBlank(cells: Cells): boolean {
  const { units, ...rest } = cells;
  return (
    Object.values(rest).every((value) => value === '') &&
    units.every((unit) => !unit.name && !unit.count && !unit.price)
  );
}

interface Portion {
  numerator: number;
  denominator: number;
  /** The unit it is a part of — "carton" in "1/2 carton". */
  unit: string;
}

/**
 * "1/2 carton" → a half of the carton. Named with a slash, as the product
 * form names portions, because the PDF fonts have no ½ or ⅓.
 */
function readPortion(name: string): Portion | null {
  const match = /^(\d+)\s*\/\s*(\d+)\s+(.+)$/.exec(name.trim());
  if (!match) return null;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (numerator < 1 || denominator < 2 || numerator >= denominator) return null;
  return { numerator, denominator, unit: match[3].trim() };
}

function errorRow(line: number, name: string, messages: string[]): PlannedRow {
  return { line, name, status: 'error', messages, product: null };
}
