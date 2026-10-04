import {
  cartonFactor,
  rollUpTargets,
  type ReceiptLine,
} from './purchase-target';

/** "112 cartons of lotion" — any lotion counts. */
const LOTION = {
  id: 't-lotion',
  categoryId: 'cat-lotions',
  targetCartons: 112,
};

const line = (overrides: Partial<ReceiptLine>): ReceiptLine => ({
  productId: 'perfect-radiant',
  categoryId: 'cat-lotions',
  quantityPaidFor: 12,
  cartonFactor: 12,
  ...overrides,
});

describe('rollUpTargets', () => {
  it('counts every product in the category, each in its own carton', () => {
    const [progress] = rollUpTargets(
      [LOTION],
      [
        // 10 cartons of 12, and 5 cartons of 24 — fifteen cartons, not 240 pieces.
        line({
          productId: 'perfect-radiant',
          quantityPaidFor: 120,
          cartonFactor: 12,
        }),
        line({ productId: 'deep', quantityPaidFor: 120, cartonFactor: 24 }),
      ],
    );
    expect(progress.achievedCartons).toBe(15);
    expect(progress.remainingCartons).toBe(97);
  });

  it('counts a part-carton — a half-slot delivery is 9.5', () => {
    const [progress] = rollUpTargets(
      [LOTION],
      [line({ quantityPaidFor: 114, cartonFactor: 12 })],
    );
    expect(progress.achievedCartons).toBe(9.5);
  });

  it('counts only cartons paid for, not free goods', () => {
    // 10 arrived, 9 charged: quantityPaidFor is what the line carries.
    const [progress] = rollUpTargets(
      [LOTION],
      [line({ quantityPaidFor: 9 * 12 })],
    );
    expect(progress.achievedCartons).toBe(9);
  });

  it('ignores other categories', () => {
    const [progress] = rollUpTargets(
      [LOTION],
      [line({ categoryId: 'cat-roll-on' }), line({ categoryId: null })],
    );
    expect(progress.achievedCartons).toBe(0);
  });

  it('cannot count a product with no carton, rather than counting its pieces as cartons', () => {
    const [progress] = rollUpTargets(
      [LOTION],
      [line({ quantityPaidFor: 30, cartonFactor: null })],
    );
    expect(progress.achievedCartons).toBe(0);
  });

  it('reports progress in basis points, and never a negative remainder', () => {
    const [met] = rollUpTargets(
      [{ ...LOTION, targetCartons: 10 }],
      [line({ quantityPaidFor: 12 * 12 })],
    );
    expect(met.achievedBps).toBe(12000);
    expect(met.remainingCartons).toBe(0);
  });

  it('reads a zero target as met rather than infinite', () => {
    const [progress] = rollUpTargets([{ ...LOTION, targetCartons: 0 }], []);
    expect(progress.achievedBps).toBe(10000);
  });
});

describe('cartonFactor', () => {
  it('is the biggest unit, whatever it is called — tray, carton, box', () => {
    expect(cartonFactor([{ factor: 1 }, { factor: 3 }, { factor: 24 }])).toBe(
      24,
    );
  });

  it('ignores portions, which are always smaller than the carton', () => {
    // sachet, roll, 1/6 carton, 1/2 carton, carton
    expect(
      cartonFactor([
        { factor: 1 },
        { factor: 10 },
        { factor: 35 },
        { factor: 105 },
        { factor: 210 },
      ]),
    ).toBe(210);
  });

  it('is null for a product with nothing bigger than its base unit', () => {
    expect(cartonFactor([{ factor: 1 }])).toBeNull();
  });
});
