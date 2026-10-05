import {
  costPriceAfterOpening,
  planOpeningStock,
  type OpeningProduct,
} from './opening-stock';

const peak: OpeningProduct = {
  id: 'peak',
  name: 'Peak 14g',
  units: [
    { id: 'sachet', name: 'sachet', factor: 1 },
    { id: 'roll', name: 'roll', factor: 10 },
    { id: 'carton', name: 'carton', factor: 160 },
  ],
};
const milo: OpeningProduct = {
  id: 'milo',
  name: 'Milo 500g',
  units: [{ id: 'tin', name: 'tin', factor: 1 }],
};
const catalog = new Map([
  [peak.id, peak],
  [milo.id, milo],
]);

describe('planOpeningStock', () => {
  it('counts in base units and values each line at cost × quantity, exactly', () => {
    const plan = planOpeningStock(
      [
        {
          productId: 'peak',
          unitId: 'carton',
          quantity: 14,
          unitCost: 1_400_000,
        },
      ],
      catalog,
      new Set(),
    );

    expect(plan.lines).toEqual([
      { productId: 'peak', quantity: 14 * 160, totalCost: 14 * 1_400_000 },
    ]);
    expect(plan.problems).toEqual([]);
  });

  it('takes cartons and loose rolls of one product as two lots', () => {
    const plan = planOpeningStock(
      [
        {
          productId: 'peak',
          unitId: 'carton',
          quantity: 14,
          unitCost: 1_400_000,
        },
        { productId: 'peak', unitId: 'roll', quantity: 3, unitCost: 90_000 },
      ],
      catalog,
      new Set(),
    );
    expect(plan.lines.map((line) => line.quantity)).toEqual([2240, 30]);
  });

  it('keeps the expiry when one is given', () => {
    const plan = planOpeningStock(
      [
        {
          productId: 'milo',
          unitId: 'tin',
          quantity: 5,
          unitCost: 250_000,
          expiryDate: '2027-03-31',
        },
      ],
      catalog,
      new Set(),
    );
    expect(plan.lines[0].expiryDate).toEqual(new Date('2027-03-31'));
  });

  it('names every product that already has stock here, so nothing counts twice', () => {
    const plan = planOpeningStock(
      [
        { productId: 'peak', unitId: 'carton', quantity: 1, unitCost: 1 },
        { productId: 'peak', unitId: 'roll', quantity: 1, unitCost: 1 },
        { productId: 'milo', unitId: 'tin', quantity: 1, unitCost: 1 },
      ],
      catalog,
      new Set(['peak']),
    );
    expect(plan.alreadyStocked).toEqual(['Peak 14g']);
    expect(plan.lines.map((line) => line.productId)).toEqual(['milo']);
  });

  it('refuses a unit that belongs to another product', () => {
    const plan = planOpeningStock(
      [{ productId: 'milo', unitId: 'carton', quantity: 1, unitCost: 1 }],
      catalog,
      new Set(),
    );
    expect(plan.problems[0]).toContain('Milo 500g');
  });

  it('refuses a product it was not given — gone, or not keeping stock', () => {
    const plan = planOpeningStock(
      [{ productId: 'delivery', unitId: 'trip', quantity: 1, unitCost: 1 }],
      catalog,
      new Set(),
    );
    expect(plan.problems).toHaveLength(1);
    expect(plan.lines).toEqual([]);
  });

  it('refuses a total too large for the column rather than wrapping it', () => {
    const plan = planOpeningStock(
      [
        {
          productId: 'milo',
          unitId: 'tin',
          quantity: 10_000,
          unitCost: 2_000_000,
        },
      ],
      catalog,
      new Set(),
    );
    expect(plan.problems[0]).toContain('too large');
  });
});

describe('costPriceAfterOpening', () => {
  it('is the total over the base units, rounded once', () => {
    // 2,240 sachets for ₦196,000 and 30 for ₦2,700: 19,870,000 / 2,270.
    const prices = costPriceAfterOpening([
      { productId: 'peak', quantity: 2240, totalCost: 19_600_000 },
      { productId: 'peak', quantity: 30, totalCost: 270_000 },
    ]);
    expect(prices.get('peak')).toBe(Math.round(19_870_000 / 2270));
  });
});
