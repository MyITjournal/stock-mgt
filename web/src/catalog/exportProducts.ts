import { api } from '../api/client';
import type { components } from '../api/schema';
import { downloadSheet, stamp, type SheetColumn } from '../lib/exportSheet';
import { headerOf, unitHeaders } from '../lib/spreadsheet';

type ProductView = components['schemas']['ProductView'];
type VariantView = components['schemas']['ProductVariantView'];

/** One row of the file: a product, or one option of it. */
interface Row {
  product: ProductView;
  variant: VariantView | null;
  /** The first row of its product. */
  first: boolean;
}

/**
 * The catalog as a spreadsheet, **in the import template's own columns** —
 * Name, Size, Category, Counted in, Price, then each bigger unit with how many
 * it holds and its price, then Barcode, Option type and Option — so the file is
 * the template filled in. A product with more units than the template has room
 * for gets Unit 4, Unit 5 and so on after the last.
 *
 * **A product with options is a row per option** (§24), as the import reads
 * them: same name and size, Option type on each, the option in Option. Each
 * row's prices are what that option sells at — its own where it has one, else
 * the product's — so the file says what the till charges. Retired options are
 * left out: they are no longer sold, and an import would bring them back as
 * live ones.
 *
 * Prices are the **default price list's**, which is where an import puts them,
 * with the counted-in unit's price from the base price as on the form. A
 * bigger unit with no price of its own is left blank rather than showing
 * what the fallback would charge: blank is what is set.
 *
 * Read fresh from `GET /products`, unfiltered, so a download is the whole
 * catalog whatever the screen is searching for.
 */
export async function exportProducts(seesCost: boolean): Promise<void> {
  const products = await api.get<ProductView[]>('/products');

  const rows = products.flatMap((product): Row[] => {
    const options = product.variants
      .filter((variant) => variant.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    return options.length > 0
      ? options.map((variant, index) => ({
          product,
          variant,
          first: index === 0,
        }))
      : [{ product, variant: null, first: true }];
  });

  const bigger = (product: ProductView) =>
    [...product.units]
      .filter((unit) => !unit.isBase)
      .sort((a, b) => a.factor - b.factor);
  const extraSlots = Math.max(0, ...products.map((p) => bigger(p).length));

  // The option's own price, else the product's — never another option's
  // (§24), which would otherwise be found first for whichever came back first.
  const priceOf = (row: Row, unitId: string, isBase: boolean) => {
    const onList = (variantId: string | null) =>
      row.product.prices.find(
        (price) =>
          price.unitId === unitId &&
          price.tier.isDefault &&
          (price.variantId ?? null) === variantId,
      )?.price;
    return (
      (row.variant ? onList(row.variant.id) : undefined) ??
      onList(null) ??
      (isBase ? row.product.basePrice : null)
    );
  };

  const baseOf = (p: ProductView) => p.units.find((u) => u.isBase);
  // A row's barcodes: its option's own, or — for the first row only, so a
  // file read back in does not refuse them as repeats — those on every option.
  const barcodesOf = (row: Row) =>
    row.product.barcodes.filter((code) =>
      row.variant
        ? code.variantId === row.variant.id || (!code.variantId && row.first)
        : !code.variantId,
    );
  const mainBarcode = (row: Row) => {
    const base = baseOf(row.product);
    return barcodesOf(row).find(
      (code) =>
        code.unitId === base?.id &&
        (code.variantId ?? null) === (row.variant?.id ?? null),
    );
  };

  const columns: SheetColumn<Row>[] = [
    { header: headerOf('name'), value: (r) => r.product.name, width: 32 },
    { header: headerOf('size'), value: (r) => r.product.size, width: 10 },
    {
      header: headerOf('category'),
      value: (r) => r.product.category?.name,
      width: 18,
    },
    {
      header: headerOf('countedIn'),
      value: (r) => baseOf(r.product)?.name,
      width: 12,
    },
    {
      header: headerOf('price'),
      kind: 'money',
      value: (r) => {
        const base = baseOf(r.product);
        return base ? priceOf(r, base.id, true) : null;
      },
    },
  ];

  for (let slot = 0; slot < Math.max(2, extraSlots); slot++) {
    const headers = unitHeaders(slot + 2);
    const unitAt = (r: Row) => bigger(r.product)[slot];
    columns.push(
      { header: headers.name, value: (r) => unitAt(r)?.name, width: 12 },
      {
        header: headers.count,
        kind: 'number',
        value: (r) => unitAt(r)?.factor,
      },
      {
        header: headers.price,
        kind: 'money',
        value: (r) => {
          const unit = unitAt(r);
          return unit ? priceOf(r, unit.id, false) : null;
        },
      },
    );
  }

  columns.push(
    {
      header: headerOf('barcode'),
      value: (r) => mainBarcode(r)?.code,
      width: 16,
    },
    {
      header: headerOf('optionType'),
      value: (r) =>
        r.variant ? r.product.variantAttributes.join(' / ') : null,
      width: 14,
    },
    {
      header: headerOf('option'),
      value: (r) => r.variant?.name,
      width: 18,
    },
    {
      header: 'Other barcodes',
      value: (r) => {
        const main = mainBarcode(r);
        return barcodesOf(r)
          .filter((code) => code !== main)
          .map(
            (code) =>
              `${code.unit.name}${r.variant && !code.variantId ? ' (every option)' : ''}: ${code.code}`,
          )
          .join('; ');
      },
      width: 28,
    },
    { header: 'SKU', value: (r) => r.product.sku, width: 18 },
  );

  if (seesCost) {
    columns.push({
      // Shown as the product page shows it: from the last delivery, per
      // counted-in unit. Absent for a role that may not see it.
      header: 'Cost price (last delivery)',
      kind: 'money',
      value: (r) => r.product.costPrice,
      width: 16,
    });
  }

  await downloadSheet(stamp('products'), columns, rows);
}
