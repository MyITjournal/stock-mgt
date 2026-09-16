import { ReceiptLine, TargetRow, rollUpTargets } from './purchase-target';

const line = (over: Partial<ReceiptLine> = {}): ReceiptLine => ({
  productId: 'prod-lotion-a',
  categoryId: 'cat-lotions',
  quantityPaidFor: 10,
  totalCost: 1_000_000,
  ...over,
});

const target = (over: Partial<TargetRow> = {}): TargetRow => ({
  id: 'target-1',
  categoryId: 'cat-lotions',
  productId: null,
  targetQuantity: 100,
  targetValue: null,
  ...over,
});

describe('rollUpTargets', () => {
  it('counts what arrived against a category target', () => {
    const [progress] = rollUpTargets(
      [target()],
      [line({ quantityPaidFor: 40 }), line({ quantityPaidFor: 25 })],
    );

    expect(progress.achievedQuantity).toBe(65);
    expect(progress.remainingQuantity).toBe(35);
    expect(progress.achievedBps).toBe(6500);
  });

  it('counts a product target from that product alone', () => {
    const [progress] = rollUpTargets(
      [target({ categoryId: null, productId: 'prod-lotion-a' })],
      [
        line({ productId: 'prod-lotion-a', quantityPaidFor: 30 }),
        line({ productId: 'prod-lotion-b', quantityPaidFor: 50 }),
      ],
    );

    expect(progress.achievedQuantity).toBe(30);
  });

  it('does not count a product twice when it has its own target', () => {
    // The rule the whole module exists for. Without the subtraction, 30 cartons
    // of lotion A would advance both the SKU target and the lotions target, and
    // our numbers would disagree with the vendor's own sheet.
    const [lotions, lotionA] = rollUpTargets(
      [
        target({ id: 'lotions' }),
        target({
          id: 'lotion-a',
          categoryId: null,
          productId: 'prod-lotion-a',
          targetQuantity: 40,
        }),
      ],
      [
        line({ productId: 'prod-lotion-a', quantityPaidFor: 30 }),
        line({ productId: 'prod-lotion-b', quantityPaidFor: 20 }),
      ],
    );

    expect(lotionA.achievedQuantity).toBe(30);
    // Only lotion B, because lotion A is accounted for on its own row.
    expect(lotions.achievedQuantity).toBe(20);
  });

  it('ignores a product in another category', () => {
    const [progress] = rollUpTargets(
      [target()],
      [line({ categoryId: 'cat-roll-on', quantityPaidFor: 60 })],
    );

    expect(progress.achievedQuantity).toBe(0);
  });

  it('does not treat an uncategorised product as a category match', () => {
    // Both are "no category", which must not read as the same category.
    const [progress] = rollUpTargets(
      [target({ categoryId: 'cat-lotions' })],
      [line({ categoryId: null, quantityPaidFor: 60 })],
    );

    expect(progress.achievedQuantity).toBe(0);
  });

  it('counts only what the vendor was paid for', () => {
    // Free goods are real stock and count for valuation, but "buy 19 get 1
    // free" advances a case quota by 19.
    const [progress] = rollUpTargets(
      [target()],
      [line({ quantityPaidFor: 19, totalCost: 1_900_000 })],
    );

    expect(progress.achievedQuantity).toBe(19);
  });

  it('sums achieved value from the invoice totals', () => {
    const [progress] = rollUpTargets(
      [target({ targetValue: 5_000_000 })],
      [line({ totalCost: 1_250_000 }), line({ totalCost: 2_000_000 })],
    );

    expect(progress.achievedValue).toBe(3_250_000);
    expect(progress.remainingValue).toBe(1_750_000);
  });

  it('leaves remaining value null when the quota is only in cases', () => {
    const [progress] = rollUpTargets([target()], [line()]);

    expect(progress.targetValue).toBeNull();
    expect(progress.remainingValue).toBeNull();
    // Value still accrues, so a client can show it even with no money quota.
    expect(progress.achievedValue).toBe(1_000_000);
  });

  it('never reports negative remaining when the target is beaten', () => {
    const [progress] = rollUpTargets(
      [target({ targetQuantity: 100, targetValue: 1_000_000 })],
      [line({ quantityPaidFor: 130, totalCost: 1_400_000 })],
    );

    expect(progress.remainingQuantity).toBe(0);
    expect(progress.remainingValue).toBe(0);
    // Progress past the target is still reported honestly.
    expect(progress.achievedBps).toBe(13000);
  });

  it('reads a zero target as met rather than dividing by it', () => {
    const [progress] = rollUpTargets([target({ targetQuantity: 0 })], []);

    expect(progress.achievedBps).toBe(10000);
  });

  it('reports nothing received as nothing achieved', () => {
    const [progress] = rollUpTargets([target()], []);

    expect(progress.achievedQuantity).toBe(0);
    expect(progress.remainingQuantity).toBe(100);
    expect(progress.achievedBps).toBe(0);
  });
});
