import {
  displayUnit,
  planCorrection,
  type RecordedLine,
} from './delivery-correction';

/** The owner's case: 7 cartons of 14 recorded, 6½ arrived, 6 of them paid for. */
const recorded: RecordedLine = {
  id: 'line-1',
  productId: 'lotion',
  variantId: null,
  batchId: 'batch-1',
  unitFactor: 14,
  quantityReceived: 98,
  quantityPaidFor: 98,
  totalCost: 9_800_000,
};

describe('planCorrection', () => {
  it('moves a line to the right product, keeping its figures, and leaves the bill alone', () => {
    const plan = planCorrection(
      [recorded],
      [
        {
          lineId: 'line-1',
          productId: 'roll-on',
          received: 98,
          paidFor: 98,
          totalCost: 9_800_000,
        },
      ],
    );

    expect(plan.problems).toEqual([]);
    expect(plan.changes).toEqual([
      expect.objectContaining({ newProductId: 'roll-on', stockDelta: 98 }),
    ]);
    expect(plan.valueDelta).toBe(0);
  });

  it('treats naming the product already recorded as no change of product', () => {
    const plan = planCorrection(
      [recorded],
      [
        {
          lineId: 'line-1',
          productId: 'lotion',
          received: 98,
          paidFor: 98,
          totalCost: 9_800_000,
        },
      ],
    );
    expect(plan.problems[0]).toMatch(/Nothing changed/);
  });

  it('takes a line to nothing when none of it came, value and all', () => {
    const plan = planCorrection(
      [recorded],
      [{ lineId: 'line-1', received: 0, paidFor: 0, totalCost: 0 }],
    );
    expect(plan.problems).toEqual([]);
    expect(plan.changes[0]).toMatchObject({ stockDelta: -98 });
    expect(plan.valueDelta).toBe(-9_800_000);
  });

  it('refuses a value on a line where nothing arrived', () => {
    const plan = planCorrection(
      [recorded],
      [{ lineId: 'line-1', received: 0, paidFor: 0, totalCost: 100 }],
    );
    expect(plan.problems[0]).toMatch(/Nothing arrived on a line/);
  });

  it('refuses the right product with nothing of it arriving', () => {
    const plan = planCorrection(
      [recorded],
      [
        {
          lineId: 'line-1',
          productId: 'roll-on',
          received: 0,
          paidFor: 0,
          totalCost: 0,
        },
      ],
    );
    expect(plan.problems[0]).toMatch(/Choose the product that did arrive/);
  });

  it('takes out what never arrived and moves the value by the difference', () => {
    const plan = planCorrection(
      [recorded],
      [{ lineId: 'line-1', received: 91, paidFor: 84, totalCost: 8_400_000 }],
    );

    expect(plan.problems).toEqual([]);
    expect(plan.changes).toEqual([
      expect.objectContaining({ received: 91, paidFor: 84, stockDelta: -7 }),
    ]);
    expect(plan.valueDelta).toBe(-1_400_000);
  });

  it('brings in what arrived but was not entered — the other way round', () => {
    const plan = planCorrection(
      [
        {
          ...recorded,
          quantityReceived: 91,
          quantityPaidFor: 91,
          totalCost: 9_100_000,
        },
      ],
      [{ lineId: 'line-1', received: 98, paidFor: 98, totalCost: 9_800_000 }],
    );
    expect(plan.changes[0].stockDelta).toBe(7);
    expect(plan.valueDelta).toBe(700_000);
  });

  it('corrects only the value when the count was right', () => {
    const plan = planCorrection(
      [recorded],
      [{ lineId: 'line-1', received: 98, paidFor: 98, totalCost: 9_500_000 }],
    );
    expect(plan.changes[0].stockDelta).toBe(0);
    expect(plan.valueDelta).toBe(-300_000);
  });

  it('takes a correction to the delivery fee alone, with no line moving (2026-10-09)', () => {
    const plan = planCorrection([recorded], [], { feeChanged: true });
    expect(plan.problems).toEqual([]);
    expect(plan.changes).toEqual([]);
    // The fee never moves the bill: the driver was paid, not the vendor.
    expect(plan.valueDelta).toBe(0);
  });

  it('refuses a correction that changes nothing', () => {
    expect(planCorrection([recorded], []).problems[0]).toContain(
      'Nothing changed',
    );
    const plan = planCorrection(
      [recorded],
      [{ lineId: 'line-1', received: 98, paidFor: 98, totalCost: 9_800_000 }],
    );
    expect(plan.problems[0]).toContain('Nothing changed');
  });

  it('refuses more paid for than arrived', () => {
    const plan = planCorrection(
      [recorded],
      [{ lineId: 'line-1', received: 84, paidFor: 91, totalCost: 1 }],
    );
    expect(plan.problems[0]).toContain('paid for than arrived');
  });

  it('refuses a line that is not on the delivery, or the same line twice', () => {
    expect(
      planCorrection(
        [recorded],
        [{ lineId: 'other', received: 1, paidFor: 1, totalCost: 1 }],
      ).problems[0],
    ).toContain('not on this delivery');
    const twice = { lineId: 'line-1', received: 91, paidFor: 91, totalCost: 1 };
    expect(planCorrection([recorded], [twice, twice]).problems).toContain(
      'A line was given twice.',
    );
  });
});

describe('planCorrection — the wrong option (2026-10-08)', () => {
  /** Eva Soap entered as Gold; the line's figures as recorded. */
  const gold: RecordedLine = {
    ...recorded,
    productId: 'eva',
    variantId: 'gold',
  };
  const asRecorded = {
    lineId: 'line-1',
    received: 98,
    paidFor: 98,
    totalCost: 9_800_000,
  };

  it('swaps the option, keeping the figures and the bill', () => {
    const plan = planCorrection(
      [gold],
      [{ ...asRecorded, variantId: 'moringa' }],
    );
    expect(plan.problems).toEqual([]);
    expect(plan.changes).toEqual([
      expect.objectContaining({
        newProductId: null,
        newOption: true,
        variantId: 'moringa',
        stockDelta: 98,
      }),
    ]);
    expect(plan.valueDelta).toBe(0);
  });

  it('swaps the option and corrects the count in one go', () => {
    const plan = planCorrection(
      [gold],
      [
        {
          lineId: 'line-1',
          variantId: 'moringa',
          received: 91,
          paidFor: 84,
          totalCost: 8_400_000,
        },
      ],
    );
    expect(plan.changes[0]).toEqual(
      expect.objectContaining({
        newOption: true,
        received: 91,
        stockDelta: 91,
      }),
    );
    expect(plan.valueDelta).toBe(-1_400_000);
  });

  it('treats naming the recorded option, or none, as no change of option', () => {
    for (const variantId of ['gold', undefined]) {
      const plan = planCorrection([gold], [{ ...asRecorded, variantId }]);
      expect(plan.problems[0]).toMatch(/Nothing changed/);
    }
  });

  it('keeps the recorded option on a count-only correction', () => {
    const plan = planCorrection(
      [gold],
      [{ ...asRecorded, received: 91, paidFor: 91 }],
    );
    expect(plan.changes[0]).toEqual(
      expect.objectContaining({
        newOption: false,
        variantId: 'gold',
        stockDelta: -7,
      }),
    );
  });

  it('refuses the right option with nothing of it arriving', () => {
    const plan = planCorrection(
      [gold],
      [
        {
          lineId: 'line-1',
          variantId: 'moringa',
          received: 0,
          paidFor: 0,
          totalCost: 0,
        },
      ],
    );
    expect(plan.problems[0]).toContain('Choose the option that did arrive');
  });

  it('takes the right product’s option with a wrong product', () => {
    const plan = planCorrection(
      [gold],
      [{ ...asRecorded, productId: 'indomie', variantId: 'chicken' }],
    );
    expect(plan.changes[0]).toEqual(
      expect.objectContaining({
        newProductId: 'indomie',
        newOption: false,
        variantId: 'chicken',
      }),
    );
  });
});

describe('displayUnit', () => {
  const units = [
    { name: 'piece', factor: 1 },
    { name: '1/2 carton', factor: 7 },
    { name: 'carton', factor: 14 },
  ];

  it('shows whole cartons as cartons', () => {
    expect(displayUnit({ received: 84, paidFor: 84 }, units).name).toBe(
      'carton',
    );
  });

  it('shows 6½ cartons as pieces, never as thirteen half cartons', () => {
    expect(displayUnit({ received: 91, paidFor: 84 }, units).name).toBe(
      'piece',
    );
  });

  it('returns to cartons after being corrected back', () => {
    expect(displayUnit({ received: 98, paidFor: 98 }, units).factor).toBe(14);
  });
});
