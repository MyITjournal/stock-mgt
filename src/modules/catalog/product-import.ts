import { randomUUID } from 'node:crypto';
import { BarcodeSymbology, BusinessType } from '@prisma/client';
import { resolveBarcode } from './barcode';
import { generateSku } from './product.service';
import { chooseDefaultSellingUnit, defaultIsSellable } from './selling-units';
import { MAX_PRODUCT_CHILDREN } from '../../common/pagination/request-limits';
import {
  MAX_VARIANT_ATTRIBUTES,
  cleanVariantText,
  variantKey,
  variantName,
} from './variants';

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
 * ## Options: a row per option (§24, 2026-10-08)
 *
 * Indomie in Chicken, Onion and Pepper Soup is **three rows with the same name
 * and size**, each with its **Option** filled in, and **Option type** saying
 * what they differ by ("Flavour"; "Flavour / Pack size" with options like
 * "Chicken / 70g"). Owner's answer, 2026-10-08: a row per option, as the till
 * and the stock screens show them.
 *
 * - The **first row is the product**: its units, category and prices are the
 *   product's, and it is the first option. Options share the units (§24), so a
 *   later row may repeat them or leave them blank, but not differ.
 * - **A later row's price is that option's own price only where it differs**
 *   from the first row's; blank, or the same, is the product's price. Ten
 *   flavours at one price are priced once, as on the form.
 * - A row's **barcode goes on its option**.
 * - Option type left blank is "Option" — one fewer thing to fill in.
 * - **A product goes in whole or not at all**: one option row in error stops
 *   every row of that product, so a file never adds half the flavours.
 *
 * ## What it deliberately does not do
 *
 * - **Update a product that already exists.** Same name **and size**, case
 *   aside, and the row is skipped with a reason. Name and size together are a
 *   product's identity here, as they are on the till and the receipt: "Dry
 *   Impact" the 50ml roll-on and "Dry Impact" the 200ml spray are two
 *   products, and the first version refused the second as a repeat. Changing prices in bulk belongs with export:
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
  /** What the options differ by: "Flavour", or "Flavour / Pack size". */
  optionType?: string;
  /** This row's option: "Chicken", or "Chicken / 70g". */
  option?: string;
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
  /** Live products, as `productKey(name, size)`. */
  existingProducts: ReadonlySet<string>;
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
  /** For a product without options; an option's barcode is on the option. */
  barcode: { code: string; symbology: BarcodeSymbology } | null;
  /** What the options differ by. Empty for a product without options. */
  variantAttributes: string[];
  variants: PlannedVariant[];
}

export interface PlannedVariant {
  id: string;
  values: string[];
  name: string;
  key: string;
  sortOrder: number;
  /**
   * Its own prices on the default list, only where they differ from the
   * product's. Kobo, VAT included.
   */
  prices: { unitId: string; price: number }[];
  barcode: { code: string; symbology: BarcodeSymbology } | null;
}

export type RowStatus = 'add' | 'skip' | 'error';

export interface PlannedRow {
  line: number;
  name: string;
  status: RowStatus;
  /** Problems for `error`, the reason for `skip`, warnings for `add`. */
  messages: string[];
  /** Every row of a product with options carries the same product. */
  product: PlannedProduct | null;
  /** The option this row adds, for a product with options. */
  variant: PlannedVariant | null;
}

export interface ImportPlan {
  rows: PlannedRow[];
  /** Categories this import creates. */
  newCategories: { id: string; name: string }[];
  /** Deleted categories this import brings back. */
  revivedCategories: { id: string; name: string }[];
  /** Products added — not rows: a product with options is several rows. */
  adding: number;
  /** Options added, across those products. */
  options: number;
  skipped: number;
  errors: number;
  defaultTierId: string | null;
}

/**
 * What makes two products the same one: the name and the size, each with case
 * and surrounding spaces ignored. "Dry Impact" 50ml and "Dry Impact" 200ml are
 * two products; "dry impact" 50ML is the first of them again.
 */
export function productKey(
  name: string,
  size: string | null | undefined,
): string {
  return `${name.trim().toLowerCase()}|${(size ?? '').trim().toLowerCase()}`;
}

/** The most rows one file may carry. */
export const MAX_IMPORT_ROWS = 2000;

const LIMITS = {
  name: 200,
  size: 40,
  unit: 40,
  category: 120,
  option: 40,
} as const;

export function planImport(
  inputs: readonly ImportRowInput[],
  context: ImportContext,
): ImportPlan {
  const rows: PlannedRow[] = [];
  // Each product's rows, by `productKey`: the first, then its other options.
  const groups = new Map<string, ProductGroup>();
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

  /** A barcode cell, checked against the shop and the rest of the file. */
  const readBarcode = (
    raw: string,
    line: number,
    errors: string[],
  ): PlannedProduct['barcode'] => {
    if (!raw) return null;
    if (/^\d+(\.\d+)?e\+?\d+$/i.test(raw)) {
      // A spreadsheet stores a long code as a number and shows it as
      // 6.154E+12; saved as .csv, that rounded form is all that is written,
      // and the digits are gone. Said for what it is, not as a bad check digit.
      errors.push(
        `The barcode reads ${raw}: the spreadsheet turned it into a rounded number and its digits are lost. Format the Barcode column as Text, type the codes again, and save as .xlsx.`,
      );
      return null;
    }
    const resolved = resolveBarcode({ code: raw });
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
      return resolved;
    }
    return null;
  };

  /**
   * A later row of a product with options: one more option, sharing the first
   * row's units, with its own price only where it differs.
   */
  const planOption = (
    group: ProductGroup,
    cells: Cells,
    line: number,
    name: string,
  ): PlannedRow => {
    const product = group.product;
    if (!product) {
      return errorRow(line, name, [
        `Row ${group.line}, the first row of this product, needs fixing first.`,
      ]);
    }
    const errors: string[] = [];
    const option = readOption(
      cells.optionType,
      cells.option,
      group.attributes,
      errors,
    );
    if (option) {
      if (group.keys.has(variantKey(option.values))) {
        errors.push(
          `"${variantName(option.values)}" is already an option of this product, in an earlier row.`,
        );
      } else if (product.variants.length >= MAX_PRODUCT_CHILDREN) {
        errors.push(
          `A product can have up to ${MAX_PRODUCT_CHILDREN} options.`,
        );
      }
    }

    // Options share the product: what the first row says, this one may repeat
    // or leave blank, but not change.
    if (
      cells.category &&
      cells.category.toLowerCase() !== group.categoryName.toLowerCase()
    ) {
      errors.push(
        `Options share the product's category, and row ${group.line} says "${group.categoryName || 'none'}". Leave this one blank or the same.`,
      );
    }
    if (
      cells.countedIn &&
      cells.countedIn.toLowerCase() !== group.baseName.toLowerCase()
    ) {
      errors.push(
        `Options share the product's units, and row ${group.line} counts in ${group.baseName}. Leave Counted in blank or the same.`,
      );
    }

    const prices: PlannedVariant['prices'] = [];
    // An option's own price is one that differs from the product's.
    const ownPrice = (raw: string, known: KnownUnit) => {
      const price = readPrice(raw, known.unit.name, errors);
      if (price === null || price === known.price) return;
      if (!known.unit.isSellable) {
        errors.push(
          `${known.unit.name} is not sold at the till — row ${group.line} gives it no price — so an option cannot have its own price for it.`,
        );
        return;
      }
      prices.push({ unitId: known.unit.id, price });
    };

    ownPrice(cells.price, group.units.get(group.baseName.toLowerCase())!);
    cells.units.forEach((slot, index) => {
      if (!slot.name) {
        if (slot.count || slot.price) {
          errors.push(
            `Unit ${index + 2} has a number but no name. Say what it is — pack, carton, 1/2 carton.`,
          );
        }
        return;
      }
      const known = group.units.get(slot.name.toLowerCase());
      if (!known) {
        errors.push(
          `Options share the product's units, and row ${group.line} has no "${slot.name}". Add it there.`,
        );
        return;
      }
      const count = slot.count.replace(/[,\s]/g, '').replace(/\.0+$/, '');
      if (count && count !== String(known.unit.factor)) {
        errors.push(
          `A ${known.unit.name} holds ${known.unit.factor} ${group.baseName} in row ${group.line}. Options share the product's units — leave "how many" blank or the same.`,
        );
      }
      ownPrice(slot.price, known);
    });

    const barcode = readBarcode(cells.barcode, line, errors);
    if (errors.length > 0 || !option) return errorRow(line, name, errors);

    const variant: PlannedVariant = {
      id: randomUUID(),
      values: option.values,
      name: variantName(option.values),
      key: variantKey(option.values),
      sortOrder: product.variants.length,
      prices,
      barcode,
    };
    product.variants.push(variant);
    group.keys.add(variant.key);
    return { line, name, status: 'add', messages: [], product, variant };
  };

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

    const key = productKey(name, cells.size);
    if (context.existingProducts.has(key)) {
      rows.push({
        line,
        name,
        status: 'skip',
        messages: [
          cells.size
            ? `Already in your products as ${name} ${cells.size}, so it is left as it is.`
            : 'Already in your products, so it is left as it is.',
        ],
        product: null,
        variant: null,
      });
      return;
    }
    const group = groups.get(key);
    if (group) {
      const row =
        group.option && cells.option
          ? planOption(group, cells, line, name)
          : errorRow(line, name, [
              group.option || cells.option
                ? `Same name and size as row ${group.line}. If these are options of one product, fill in Option on every row of it.`
                : `Same name and size as row ${group.line}. Each product goes in once — if they are different products, give them different sizes.`,
            ]);
      group.rows.push(row);
      rows.push(row);
      return;
    }

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

    // ── Options ────────────────────────────────────────────────────────────
    const option =
      cells.option || cells.optionType
        ? readOption(cells.optionType, cells.option, null, errors)
        : null;

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
    const barcode = readBarcode(cells.barcode, line, errors);

    const tierPrices = drafts.some((unit) => unit.price !== null);
    if (tierPrices && !context.defaultTierId) {
      errors.push(
        'Your shop has no default price list, so these prices have nowhere to go.',
      );
    }

    if (errors.length > 0) {
      const row = errorRow(line, name, errors);
      groups.set(key, {
        line,
        option: option !== null,
        attributes: option?.attributes ?? [],
        baseName,
        categoryName: cells.category,
        product: null,
        units: new Map(),
        keys: new Set(),
        rows: [row],
      });
      rows.push(row);
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

    // The first row of a product with options is its first option, and its
    // prices are the product's — so that option has none of its own.
    const variant: PlannedVariant | null = option && {
      id: randomUUID(),
      values: option.values,
      name: variantName(option.values),
      key: variantKey(option.values),
      sortOrder: 0,
      prices: [],
      barcode,
    };
    const product: PlannedProduct = {
      id: randomUUID(),
      sku: uniqueSku(name, usedSkus),
      name,
      size: cells.size || null,
      basePrice,
      category,
      units,
      barcode: variant ? null : barcode,
      variantAttributes: option?.attributes ?? [],
      variants: variant ? [variant] : [],
    };
    const row: PlannedRow = {
      line,
      name,
      status: 'add',
      messages: warnings,
      product,
      variant,
    };
    groups.set(key, {
      line,
      option: option !== null,
      attributes: option?.attributes ?? [],
      baseName,
      categoryName: cells.category,
      product,
      // What each unit sells for as the product, to tell an option's own
      // price from a repeat of it.
      units: new Map(
        units.map((unit) => [
          unit.name.toLowerCase(),
          { unit, price: unit.isBase ? basePrice : unit.price },
        ]),
      ),
      keys: new Set(variant ? [variant.key] : []),
      rows: [row],
    });
    rows.push(row);
  });

  // A product goes in whole or not at all: one option row in error stops the
  // rest of that product's rows, which would otherwise add some flavours.
  for (const group of groups.values()) {
    const failed = group.rows.find((row) => row.status === 'error');
    if (!failed) continue;
    for (const row of group.rows) {
      if (row.status !== 'add') continue;
      row.status = 'error';
      row.messages = [
        `Row ${failed.line} of this product needs fixing, so none of its rows are added.`,
      ];
      row.product = null;
      row.variant = null;
    }
  }

  const added = rows.filter((row) => row.status === 'add');
  return {
    rows,
    newCategories: [...newCategories.values()],
    revivedCategories: [...revived.values()],
    adding: new Set(added.map((row) => row.product!.id)).size,
    options: added.filter((row) => row.variant).length,
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

interface KnownUnit {
  unit: PlannedUnit;
  /** What it sells for as the product: the base price for the counted-in unit. */
  price: number | null;
}

/** One product's rows in the file, gathered by name and size. */
interface ProductGroup {
  /** The first row, which is the product. */
  line: number;
  /** Whether the first row names an option — a product with options. */
  option: boolean;
  attributes: string[];
  baseName: string;
  categoryName: string;
  /** Null when the first row is in error. */
  product: PlannedProduct | null;
  /** Each unit, by name lower-cased. */
  units: Map<string, KnownUnit>;
  /** Options taken so far, by `variantKey`. */
  keys: Set<string>;
  rows: PlannedRow[];
}

/**
 * "Flavour" and "Chicken", or "Flavour / Pack size" and "Chicken / 70g". A
 * blank type is "Option". Given `attributes` — a later row of the product —
 * the type may be blank or the same, and the values must fill them.
 */
function readOption(
  rawType: string,
  rawOption: string,
  attributes: readonly string[] | null,
  errors: string[],
): { attributes: string[]; values: string[] } | null {
  const split = (text: string) => text.split('/').map(cleanVariantText);
  if (!rawOption) {
    errors.push(
      'There is an Option type but no Option. Say which one this row is — Chicken, for instance.',
    );
    return null;
  }
  const values = split(rawOption);
  const typed = rawType ? split(rawType) : null;

  let names: string[];
  if (attributes) {
    names = [...attributes];
    if (
      typed &&
      typed.join(' / ').toLowerCase() !== names.join(' / ').toLowerCase()
    ) {
      errors.push(
        `Option type here is "${typed.join(' / ')}", but this product's first row says "${names.join(' / ')}". Every option of a product is described the same way.`,
      );
      return null;
    }
  } else if (typed) {
    names = typed;
    if (names.some((attribute) => !attribute)) {
      errors.push(
        'Option type has an empty part. Name each — Flavour / Pack size.',
      );
      return null;
    }
    if (names.length > MAX_VARIANT_ATTRIBUTES) {
      errors.push(
        `Options can differ by up to ${MAX_VARIANT_ATTRIBUTES} things — Flavour / Pack size — not ${names.length}.`,
      );
      return null;
    }
    const lower = names.map((attribute) => attribute.toLowerCase());
    if (new Set(lower).size !== lower.length) {
      errors.push('The two parts of Option type need different names.');
      return null;
    }
  } else if (values.length === 1) {
    names = ['Option'];
  } else {
    errors.push(
      `"${rawOption}" has ${values.length} parts. Say what they are in Option type — Flavour / Pack size.`,
    );
    return null;
  }

  if (values.length !== names.length || values.some((value) => !value)) {
    errors.push(
      names.length === 1
        ? `Option should be one ${names[0]}, not "${rawOption}".`
        : `Option should give a ${names.join(' and a ')}, like "Chicken / 70g" — not "${rawOption}".`,
    );
    return null;
  }
  const tooLong = [...names, ...values].find(
    (text) => text.length > LIMITS.option,
  );
  if (tooLong) {
    errors.push(`"${tooLong}" is longer than ${LIMITS.option} characters.`);
    return null;
  }
  return { attributes: names, values };
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
  optionType: string;
  option: string;
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
    optionType: cell(input.optionType),
    option: cell(input.option),
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
  return {
    line,
    name,
    status: 'error',
    messages,
    product: null,
    variant: null,
  };
}
