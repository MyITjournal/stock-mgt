import { api } from '../api/client';
import type { components } from '../api/schema';
import { downloadSheet, stamp, type SheetColumn } from '../lib/exportSheet';
import { headerOf, unitHeaders } from '../lib/spreadsheet';

type ProductView = components['schemas']['ProductView'];

/**
 * The catalog as a spreadsheet, **in the import template's own columns** —
 * Name, Size, Category, Counted in, Price, then each bigger unit with how many
 * it holds and its price, then Barcode — so the file is the template filled in.
 * A product with more units than the template has room for gets Unit 4,
 * Unit 5 and so on after the last.
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

  const bigger = (product: ProductView) =>
    [...product.units]
      .filter((unit) => !unit.isBase)
      .sort((a, b) => a.factor - b.factor);
  const extraSlots = Math.max(0, ...products.map((p) => bigger(p).length));

  // The product's own price — never an option's (§24), which would otherwise
  // be found first for whichever option happened to come back first.
  const priceOf = (product: ProductView, unitId: string, isBase: boolean) =>
    product.prices.find(
      (row) => row.unitId === unitId && row.tier.isDefault && !row.variantId,
    )?.price ?? (isBase ? product.basePrice : null);

  const columns: SheetColumn<ProductView>[] = [
    { header: headerOf('name'), value: (p) => p.name, width: 32 },
    { header: headerOf('size'), value: (p) => p.size, width: 10 },
    { header: headerOf('category'), value: (p) => p.category?.name, width: 18 },
    {
      header: headerOf('countedIn'),
      value: (p) => p.units.find((u) => u.isBase)?.name,
      width: 12,
    },
    {
      header: headerOf('price'),
      kind: 'money',
      value: (p) => {
        const base = p.units.find((u) => u.isBase);
        return base ? priceOf(p, base.id, true) : null;
      },
    },
  ];

  for (let slot = 0; slot < Math.max(2, extraSlots); slot++) {
    const headers = unitHeaders(slot + 2);
    const unitAt = (p: ProductView) => bigger(p)[slot];
    columns.push(
      { header: headers.name, value: (p) => unitAt(p)?.name, width: 12 },
      {
        header: headers.count,
        kind: 'number',
        value: (p) => unitAt(p)?.factor,
      },
      {
        header: headers.price,
        kind: 'money',
        value: (p) => {
          const unit = unitAt(p);
          return unit ? priceOf(p, unit.id, false) : null;
        },
      },
    );
  }

  columns.push(
    {
      header: headerOf('barcode'),
      value: (p) => {
        const base = p.units.find((u) => u.isBase);
        return p.barcodes.find((b) => b.unitId === base?.id)?.code;
      },
      width: 16,
    },
    {
      header: 'Other barcodes',
      value: (p) => {
        const base = p.units.find((u) => u.isBase);
        return p.barcodes
          .filter((b) => b.unitId !== base?.id)
          .map((b) => `${b.unit.name}: ${b.code}`)
          .join('; ');
      },
      width: 28,
    },
    { header: 'SKU', value: (p) => p.sku, width: 18 },
  );

  if (seesCost) {
    columns.push({
      // Shown as the product page shows it: from the last delivery, per
      // counted-in unit. Absent for a role that may not see it.
      header: 'Cost price (last delivery)',
      kind: 'money',
      value: (p) => p.costPrice,
      width: 16,
    });
  }

  await downloadSheet(stamp('products'), columns, products);
}
