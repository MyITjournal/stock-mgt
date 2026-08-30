import { lotValue, unitCost, valueByGroup, valueOf } from './valuation';

/**
 * The lot from DECISIONS.md §2: 20 cartons of 24 received, 19 paid for, at
 * ₦949,449 — so 480 base units arrived for 94,944,900 kobo.
 *
 * That is 197,801.875 kobo a piece (₦1,978.02), and the .875 is the point: it
 * is a ratio, not money, so it is computed here and never stored.
 */
const freeGoodsLot = {
  quantity: 480,
  totalCost: 94_944_900,
  quantityReceived: 480,
};

describe('unitCost', () => {
  it('is a fraction, not a rounded number', () => {
    expect(unitCost(freeGoodsLot)).toBe(197_801.875);
    expect(Number.isInteger(unitCost(freeGoodsLot))).toBe(false);
  });

  it('divides by what arrived, not by what was paid for', () => {
    // The free carton pulls the cost of every unit down; that is the whole
    // point of storing quantityReceived separately from quantityPaidFor.
    const paidForOnly = 94_944_900 / 456;
    expect(unitCost(freeGoodsLot)).toBeLessThan(paidForOnly);
  });

  it('is zero for a lot that received nothing, rather than Infinity', () => {
    expect(
      unitCost({ quantity: 0, totalCost: 5_000, quantityReceived: 0 }),
    ).toBe(0);
  });
});

describe('valueOf', () => {
  it('values an untouched lot at what it cost', () => {
    expect(valueOf([freeGoodsLot])).toBe(94_944_900);
  });

  it('values a partly sold lot pro rata', () => {
    const half = { ...freeGoodsLot, quantity: 240 };
    expect(valueOf([half])).toBe(94_944_900 / 2);
  });

  it('is zero for an empty warehouse', () => {
    expect(valueOf([])).toBe(0);
  });

  it('always returns whole kobo', () => {
    const awkward = { quantity: 7, totalCost: 100_000, quantityReceived: 3 };
    expect(Number.isInteger(valueOf([awkward]))).toBe(true);
  });

  // The §2 rule this module exists to enforce. Rounding each lot and adding
  // lets the error grow with the number of lots; rounding once does not.
  it('rounds once at the total, not once per lot', () => {
    const lots = Array.from({ length: 1_000 }, () => ({
      quantity: 1,
      totalCost: 100,
      quantityReceived: 3,
    }));

    // Exact: 1000 × 33.333... = 33,333.33
    expect(valueOf(lots)).toBe(33_333);

    const roundedPerLot = lots.reduce(
      (total, lot) => total + Math.round(lotValue(lot)),
      0,
    );
    // Rounding first gives 33,000 — ₦3.33 of drift from 1,000 lots alone.
    expect(roundedPerLot).toBe(33_000);
    expect(roundedPerLot).not.toBe(valueOf(lots));
  });

  it('carries negative stock through as negative value', () => {
    // Stock can go negative when an owner forces a movement (§5); the
    // valuation says so rather than clamping and quietly overstating assets.
    const short = {
      quantity: -48,
      totalCost: 4_800_000,
      quantityReceived: 480,
    };
    expect(valueOf([short])).toBe(-480_000);
  });

  it('nets a shortfall against stock held elsewhere', () => {
    const held = { quantity: 480, totalCost: 4_800_000, quantityReceived: 480 };
    const short = {
      quantity: -48,
      totalCost: 4_800_000,
      quantityReceived: 480,
    };
    expect(valueOf([held, short])).toBe(4_320_000);
  });
});

describe('valueByGroup', () => {
  const lots = [
    { quantity: 100, totalCost: 1_000_000, quantityReceived: 100, at: 'store' },
    { quantity: 50, totalCost: 1_000_000, quantityReceived: 100, at: 'store' },
    { quantity: 20, totalCost: 400_000, quantityReceived: 40, at: 'van' },
  ];

  it('values each group from its own lots', () => {
    const byLocation = valueByGroup(lots, (lot) => lot.at);

    expect(byLocation.get('store')).toBe(1_500_000);
    expect(byLocation.get('van')).toBe(200_000);
  });

  it('groups every lot exactly once', () => {
    const byLocation = valueByGroup(lots, (lot) => lot.at);
    expect([...byLocation.keys()].sort()).toEqual(['store', 'van']);
  });

  it('is empty for no lots', () => {
    expect(valueByGroup([], () => 'x').size).toBe(0);
  });
});
