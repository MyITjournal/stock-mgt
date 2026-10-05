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
  units: [
    { name: 'roll', count: '10', price: '950' },
    { name: 'carton', count: '160', price: '14,500' },
  ],
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

  it('sells a unit that has a price, and only counts one that has none', () => {
    // A wholesaler leaves the sachet unpriced: counted in, never sold, and
    // the till starts on the carton.
    const plan = planImport(
      [{ ...peak, price: '' }],
      context({ businessType: BusinessType.wholesale }),
    );
    const units = plan.rows[0].product!.units;

    expect(units.find((u) => u.isBase)!.isSellable).toBe(false);
    expect(units.filter((u) => u.isSellable).map((u) => u.name)).toEqual([
      'roll',
      'carton',
    ]);
    expect(units.find((u) => u.isDefaultSelling)!.name).toBe('carton');
  });

  it('works out a portion from the unit it is part of — the lotion carton of 12', () => {
    // Sold only as 1/2 and 1/4 of a carton: the carton has no price, so it is
    // counted but not offered.
    const plan = planImport(
      [
        {
          name: 'Even Glow 400ml',
          countedIn: 'piece',
          units: [
            { name: 'carton', count: '12' },
            { name: '1/2 carton', price: '29,900' },
            { name: '1/4 carton', price: '14,950' },
          ],
        },
      ],
      context(),
    );
    const units = plan.rows[0].product!.units;

    expect(plan.rows[0].status).toBe('add');
    expect(units.map((u) => [u.name, u.factor, u.isSellable])).toEqual([
      ['piece', 1, false],
      ['carton', 12, false],
      ['1/2 carton', 6, true],
      ['1/4 carton', 3, true],
    ]);
  });

  it('takes a portion written before the unit it is part of — the roll-on', () => {
    const plan = planImport(
      [
        {
          name: 'Dry impact 50ml',
          units: [
            { name: '1/2 pack', price: '4,850' },
            { name: 'pack', count: '6', price: '9,700' },
            { name: '1/2 carton', price: '24,250' },
            { name: 'carton', count: '30', price: '48,500' },
          ],
        },
      ],
      context(),
    );
    expect(plan.rows[0].product!.units.map((u) => [u.name, u.factor])).toEqual([
      ['piece', 1],
      ['pack', 6],
      ['carton', 30],
      ['1/2 pack', 3],
      ['1/2 carton', 15],
    ]);
  });

  it('refuses a portion that is not whole, saying why', () => {
    const plan = planImport(
      [
        {
          name: 'Roll-on',
          units: [
            { name: 'carton', count: '15' },
            { name: '1/2 carton', price: '24,250' },
          ],
        },
      ],
      context(),
    );
    expect(plan.rows[0].status).toBe('error');
    expect(plan.rows[0].messages[0]).toContain('7.5');
  });

  it('refuses a portion of a unit the row does not have', () => {
    const plan = planImport(
      [{ name: 'Roll-on', units: [{ name: '1/2 carton', price: '100' }] }],
      context(),
    );
    expect(plan.rows[0].messages[0]).toContain('no carton in this row');
  });

  it('refuses a portion whose count disagrees with the unit it is part of', () => {
    const plan = planImport(
      [
        {
          name: 'Lotion',
          units: [
            { name: 'carton', count: '12' },
            { name: '1/2 carton', count: '5', price: '100' },
          ],
        },
      ],
      context(),
    );
    expect(plan.rows[0].messages[0]).toContain('is 6 piece, not 5');
  });

  it('reads as many units as the row has', () => {
    const plan = planImport(
      [
        {
          name: 'Big family',
          units: [2, 4, 8, 16, 32].map((count) => ({
            name: `box of ${count}`,
            count: String(count),
            price: String(count * 100),
          })),
        },
      ],
      context(),
    );
    expect(plan.rows[0].product!.units).toHaveLength(6);
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
          units: [{ name: 'carton', count: '0.5' }, { count: '12' }],
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
      [{ name: 'Soap', units: [{ name: 'bar', count: '1' }] }],
      context(),
    );
    expect(plan.rows[0].status).toBe('error');
  });

  it('refuses two units with the same name', () => {
    const plan = planImport(
      [
        {
          name: 'Soap',
          countedIn: 'bar',
          units: [{ name: 'Bar', count: '6' }],
        },
      ],
      context(),
    );
    expect(plan.rows[0].messages).toContain(
      'Two units have the same name. Give each its own.',
    );
  });

  it('warns, without refusing, about a row with no prices at all', () => {
    const plan = planImport(
      [{ name: 'Rice 50kg', countedIn: 'bag' }],
      context(),
    );
    expect(plan.rows[0].status).toBe('add');
    expect(plan.rows[0].messages[0]).toContain('will not sell it');
  });

  it('never sells a carton by the piece price — an unpriced carton is not sold', () => {
    // The carton overcharge §4 exists to prevent: with the price rule, a
    // carton the row gives no price is counted, not sold at 12 × the piece.
    const plan = planImport(
      [
        {
          name: 'Coke 50cl',
          price: '300',
          units: [{ name: 'crate', count: '12' }],
        },
      ],
      context(),
    );
    const crate = plan.rows[0].product!.units.find((u) => u.name === 'crate')!;
    expect(crate.isSellable).toBe(false);
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
