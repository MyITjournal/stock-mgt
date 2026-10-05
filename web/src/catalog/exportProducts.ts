import { api } from '../api/client';
import type { components } from '../api/schema';
import { downloadSheet, stamp, type SheetColumn } from '../lib/exportSheet';
import { COLUMNS } from '../lib/spreadsheet';

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
  const header = (field: string) =>
    COLUMNS.find((column) => column.field === field)!.header;

  const bigger = (product: ProductView) =>
    [...product.units]
      .filter((unit) => !unit.isBase)
      .sort((a, b) => a.factor - b.factor);
  const extraSlots = Math.max(0, ...products.map((p) => bigger(p).length));

  const priceOf = (product: ProductView, unitId: string, isBase: boolean) =>
    product.prices.find((row) => row.unitId === unitId && row.tier.isDefault)
      ?.price ?? (isBase ? product.basePrice : null);

  const columns: SheetColumn<ProductView>[] = [
    { header: header('name'), value: (p) => p.name, width: 32 },
    { header: header('size'), value: (p) => p.size, width: 10 },
    { header: header('category'), value: (p) => p.category?.name, width: 18 },
    {
      header: header('countedIn'),
      value: (p) => p.units.find((u) => u.isBase)?.name,
      width: 12,
    },
    {
      header: header('price'),
      kind: 'money',
      value: (p) => {
        const base = p.units.find((u) => u.isBase);
        return base ? priceOf(p, base.id, true) : null;
      },
    },
  ];

  for (let slot = 0; slot < Math.max(2, extraSlots); slot++) {
    const n = slot + 2;
    const unitAt = (p: ProductView) => bigger(p)[slot];
    columns.push(
      { header: `Unit ${n}`, value: (p) => unitAt(p)?.name, width: 12 },
      {
        header: `Unit ${n} how many`,
        kind: 'number',
        value: (p) => unitAt(p)?.factor,
      },
      {
        header: `Unit ${n} price`,
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
      header: header('barcode'),
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
