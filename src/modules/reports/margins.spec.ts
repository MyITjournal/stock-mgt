import {
  averageUnitCost,
  dealOf,
  projectSale,
  projectionTotals,
  unitMargin,
} from './margins';

describe('averageUnitCost', () => {
  it('averages the lots on hand, weighted by what each still holds', () => {
    // 10 pieces left from a lot at ₦100 each, 30 from a lot at ₦80 each.
    const cost = averageUnitCost([
      { quantity: 10, totalCost: 2_000_000, quantityReceived: 200 },
      { quantity: 30, totalCost: 1_600_000, quantityReceived: 200 },
    ]);
    expect(cost).toBe(8_500); // (10 × 10,000 + 30 × 8,000) ÷ 40 kobo
  });

  it('counts free goods as making every piece cheaper', () => {
    // Buy 12 get 1 free: 13 cartons of 24 for the price of 12.
    const cost = averageUnitCost([
      { quantity: 312, totalCost: 12 * 4_800_000, quantityReceived: 312 },
    ]);
    expect(Math.round(cost! * 24)).toBe(4_430_769); // ₦44,307.69 a carton, not ₦48,000
  });

  it('ignores a lot driven negative, and has no average with nothing on hand', () => {
    expect(
      averageUnitCost([
        { quantity: -5, totalCost: 100_000, quantityReceived: 10 },
        { quantity: 4, totalCost: 80_000, quantityReceived: 10 },
      ]),
    ).toBe(8_000);
    expect(
      averageUnitCost([
        { quantity: -5, totalCost: 100_000, quantityReceived: 10 },
      ]),
    ).toBeNull();
    expect(averageUnitCost([])).toBeNull();
  });
});

describe('unitMargin', () => {
  it('measures the margin on the price without VAT', () => {
    // ₦10,750 with 7.5% VAT inside is ₦10,000 of the shop's money.
    const result = unitMargin({
      price: 1_075_000,
      taxRateBps: 750,
      unitCost: 900_000,
    });
    expect(result.netPrice).toBe(1_000_000);
    expect(result.margin).toBe(100_000);
    expect(result.marginBps).toBe(1_000);
  });

  it('keeps the whole price when no VAT is charged, and goes negative below cost', () => {
    const result = unitMargin({
      price: 1_000_000,
      taxRateBps: 0,
      unitCost: 1_050_000,
    });
    expect(result.margin).toBe(-50_000);
    expect(result.marginBps).toBe(-500);
  });
});

describe('dealOf', () => {
  it('says free goods the way a vendor does', () => {
    expect(dealOf(312, 288)).toEqual({ received: 13, paidFor: 12 });
    expect(dealOf(20, 19)).toEqual({ received: 20, paidFor: 19 });
  });

  it('is nothing when nothing came free', () => {
    expect(dealOf(24, 24)).toBeNull();
    expect(dealOf(10, 0)).toBeNull();
  });
});

describe('projecting the stock on hand', () => {
  it('sells what is on hand at the carton price, less what it cost', () => {
    // 81 pieces of lotion, a carton of 12 at ₦51,000 (no VAT), costing
    // ₦4,031.35 a piece on average.
    const part = projectSale({
      onHand: 81,
      unitFactor: 12,
      netPrice: 5_100_000,
      baseCost: 403_135.0154,
    });
    expect(part.revenue).toBe(34_425_000);
    expect(Math.round(part.cost)).toBe(32_653_936);
  });

  it('totals every product exactly and rounds once', () => {
    const totals = projectionTotals([
      { revenue: 1_000.4, cost: 900.3 },
      { revenue: 2_000.4, cost: 1_800.3 },
    ]);
    expect(totals).toEqual({
      revenue: 3_001,
      cost: 2_701,
      profit: 300,
      marginBps: 1_000,
    });
  });
});
