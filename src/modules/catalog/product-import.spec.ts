import { BusinessType } from '@prisma/client';
import {
  parseNaira,
  planImport,
  type ImportContext,
  type ImportRowInput,
} from './product-import';

const TIER = 'tier-retail';

const context = (overrides: Partial<ImportContext> = {}): ImportContext => ({
  existingNames: new Set(),
  existingSkus: new Set(),
  existingBarcodes: new Set(),
  categories: [],
  defaultTierId: TIER,
  businessType: BusinessType.mixed,
  ...overrides,
});

/** The template's own example: Peak 14g, by the sachet, roll and carton. */
const peak: ImportRowInput = {
  line: 2,
  name: 'Peak 14g',
  size: '14g',
  category: 'Milk',
  countedIn: 'sachet',
  price: '100',
  unit2: 'roll',
  unit2Count: '10',
  unit2Price: '950',
  unit3: 'carton',
  unit3Count: '160',
  unit3Price: '14,500',
};

describe('parseNaira', () => {
  it.each([
    ['14500', 1_450_000],
    ['14,500', 1_450_000],
    ['14,500.50', 1_450_050],
    ['₦14,500', 1_450_000],
    ['N14,500', 1_450_000],
    ['NGN 14500', 1_450_000],
    ['0', 0],
    ['.5', 50],
    ['1.45E+4', 1_450_000],
    ['1.5E-2', 2],
  ])('reads %s as %d kobo', (raw, kobo) => {
    expect(parseNaira(raw)).toEqual({ kobo });
  });

  it('rounds what a formula left behind to what the cell showed', () => {
    // 14500.499999999998 displays as 14,500.50 in the spreadsheet.
    expect(parseNaira('14500.499999999998')).toEqual({ kobo: 1_450_050 });
    expect(parseNaira('0.994')).toEqual({ kobo: 99 });
  });

  it.each(['abc', '-100', '1,2.3.4', 'N', ''])('refuses %p', (raw) => {
    expect(parseNaira(raw)).toHaveProperty('error');
  });
});

describe('planImport', () => {
  it('turns the template row into a product with three units', () => {
    const plan = planImport([peak], context());
    const [row] = plan.rows;

    expect(row.status).toBe('add');
    expect(row.product).toMatchObject({
      name: 'Peak 14g',
      sku: 'PEAK-14G',
      size: '14g',
      basePrice: 10_000,
      category: { name: 'Milk', isNew: true },
    });
    expect(row.product!.units.map((u) => [u.name, u.factor, u.price])).toEqual([
      ['sachet', 1, null],
      ['roll', 10, 95_000],
      ['carton', 160, 1_450_000],
    ]);
    expect(plan.newCategories.map((c) => c.name)).toEqual(['Milk']);
    expect(plan.adding).toBe(1);
  });

  it('sells the units exactly as the product form would', () => {
    // A wholesaler counts in sachets and never sells one, and picks the
    // carton first.
    const plan = planImport(
      [peak],
      context({ businessType: BusinessType.wholesale }),
    );
    const units = plan.rows[0].product!.units;

    expect(units.find((u) => u.isBase)!.isSellable).toBe(false);
    expect(units.find((u) => u.isDefaultSelling)!.name).toBe('carton');
  });

  it('counts in pieces when "Counted in" is left blank', () => {
    const plan = planImport([{ name: 'Indomie', price: '250' }], context());
    expect(plan.rows[0].product!.units).toEqual([
      expect.objectContaining({ name: 'piece', factor: 1, isSellable: true }),
    ]);
  });

  it('skips a product already in the catalog, case aside, and changes nothing', () => {
    const plan = planImport(
      [peak],
      context({ existingNames: new Set(['peak 14g']) }),
    );
    expect(plan.rows[0]).toMatchObject({ status: 'skip', product: null });
    expect(plan.skipped).toBe(1);
    expect(plan.newCategories).toEqual([]);
  });

  it('refuses the same name twice in one file, naming the first row', () => {
    const plan = planImport(
      [peak, { ...peak, line: 7, name: 'PEAK 14G' }],
      context(),
    );
    expect(plan.rows[1].status).toBe('error');
    expect(plan.rows[1].messages[0]).toContain('row 2');
  });

  it('says what is wrong with a row, in words', () => {
    const plan = planImport(
      [
        {
          line: 3,
          name: 'Milo 500g',
          price: 'two hundred',
          unit2: 'carton',
          unit2Count: '0.5',
          unit3Count: '12',
        },
      ],
      context(),
    );
    const [row] = plan.rows;

    expect(row.status).toBe('error');
    expect(row.messages).toEqual([
      expect.stringContaining('not an amount in naira'),
      expect.stringContaining('whole number of 2 or more'),
      expect.stringContaining('Unit 3 has a number but no name'),
    ]);
    expect(plan.errors).toBe(1);
  });

  it('refuses a unit that holds one — that would be a second base unit', () => {
    const plan = planImport(
      [{ name: 'Soap', unit2: 'bar', unit2Count: '1' }],
      context(),
    );
    expect(plan.rows[0].status).toBe('error');
  });

  it('refuses two units with the same name', () => {
    const plan = planImport(
      [{ name: 'Soap', countedIn: 'bar', unit2: 'Bar', unit2Count: '6' }],
      context(),
    );
    expect(plan.rows[0].messages).toContain(
      'Two units have the same name. Give each its own.',
    );
  });

  it('warns, without refusing, about a unit the till cannot price', () => {
    const plan = planImport(
      [{ name: 'Rice 50kg', countedIn: 'bag' }],
      context(),
    );
    expect(plan.rows[0].status).toBe('add');
    expect(plan.rows[0].messages[0]).toContain('will not sell it');
  });

  it('warns that a carton with no price of its own is charged by the piece', () => {
    // The carton overcharge §4 exists to prevent, said before it happens.
    const plan = planImport(
      [{ name: 'Coke 50cl', price: '300', unit2: 'crate', unit2Count: '12' }],
      context(),
    );
    expect(plan.rows[0].messages[0]).toContain('12 × the piece price');
  });

  it('uses a category already there, case aside, and brings a deleted one back', () => {
    const plan = planImport(
      [
        { name: 'A', category: 'milk' },
        { name: 'B', category: 'Soap' },
        { name: 'C', category: 'soap' },
      ],
      context({
        categories: [
          { id: 'cat-milk', name: 'Milk', deleted: false },
          { id: 'cat-soap', name: 'Soap', deleted: true },
        ],
      }),
    );

    expect(plan.rows[0].product!.category).toEqual({
      id: 'cat-milk',
      name: 'Milk',
      isNew: false,
    });
    expect(plan.rows[1].product!.category!.id).toBe('cat-soap');
    expect(plan.rows[2].product!.category!.id).toBe('cat-soap');
    expect(plan.revivedCategories).toEqual([{ id: 'cat-soap', name: 'Soap' }]);
    expect(plan.newCategories).toEqual([]);
  });

  it('creates a new category once, however many rows name it', () => {
    const plan = planImport(
      [
        { name: 'A', category: 'Drinks' },
        { name: 'B', category: 'drinks' },
      ],
      context(),
    );
    expect(plan.newCategories).toHaveLength(1);
    expect(plan.rows[0].product!.category!.id).toBe(
      plan.rows[1].product!.category!.id,
    );
  });

  it('checks a barcode, and refuses one already in use or used twice', () => {
    const plan = planImport(
      [
        { line: 2, name: 'A', barcode: '4006381333931' },
        { line: 3, name: 'B', barcode: '4006381333931' },
        { line: 4, name: 'C', barcode: '4006381333932' },
        { line: 5, name: 'D', barcode: '5012345678900' },
      ],
      context({ existingBarcodes: new Set(['5012345678900']) }),
    );

    expect(plan.rows[0].product!.barcode!.code).toBe('4006381333931');
    expect(plan.rows[1].messages[0]).toContain('row 2');
    expect(plan.rows[2].messages[0]).toContain('check digit');
    expect(plan.rows[3].messages[0]).toContain('already on another');
  });

  it('says plainly when a spreadsheet has rounded a barcode away', () => {
    const plan = planImport([{ name: 'A', barcode: '6.154E+12' }], context());
    expect(plan.rows[0].messages[0]).toContain(
      'Format the Barcode column as Text',
    );
  });

  it('keeps generated SKUs unique against the shop and the file', () => {
    const plan = planImport(
      [{ name: 'Peak 14g' }, { name: 'Peak-14g' }],
      context({ existingSkus: new Set(['PEAK-14G']) }),
    );
    expect(plan.rows.map((row) => row.product!.sku)).toEqual([
      'PEAK-14G-2',
      'PEAK-14G-3',
    ]);
  });

  it('ignores blank rows, and refuses a row with no name', () => {
    const plan = planImport(
      [{}, { name: '  ', size: '' }, { line: 9, size: '400g' }],
      context(),
    );
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0]).toMatchObject({ line: 9, status: 'error' });
  });

  it('refuses prices when the shop has no default price list', () => {
    const plan = planImport([peak], context({ defaultTierId: null }));
    expect(plan.rows[0].status).toBe('error');
  });
});
