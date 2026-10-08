import {
  averageSale,
  changeBps,
  compareGrowth,
  countFirstPurchases,
  type GrowthFigures,
} from './growth';

const figures = (overrides: Partial<GrowthFigures> = {}): GrowthFigures => ({
  revenue: 1_000_000_00,
  grossProfit: 100_000_00,
  marginBps: 1000,
  operatingProfit: 40_000_00,
  collected: 900_000_00,
  sales: 50,
  averageSale: 2_000_000,
  customers: 20,
  newCustomers: 4,
  ...overrides,
});

describe('changeBps', () => {
  it('says how far a figure moved', () => {
    expect(changeBps(100, 125)).toBe(2500);
    expect(changeBps(100, 80)).toBe(-2000);
  });

  it('is null, not 0, when there is nothing to compare with', () => {
    expect(changeBps(0, 500)).toBeNull();
  });

  it('reads a shrinking loss as an improvement', () => {
    expect(changeBps(-100_000, -50_000)).toBe(5000);
  });
});

describe('averageSale', () => {
  it('is revenue per sale, rounded once', () => {
    expect(averageSale(1_000, 3)).toBe(333);
  });

  it('is 0 with no sales rather than a division by zero', () => {
    expect(averageSale(0, 0)).toBe(0);
  });
});

describe('compareGrowth', () => {
  it('compares every figure, and the margin in points', () => {
    const change = compareGrowth(
      figures({ revenue: 1_200_000_00, marginBps: 1250, customers: 25 }),
      figures(),
    );
    expect(change.revenue).toBe(2000);
    expect(change.customers).toBe(2500);
    expect(change.marginPoints).toBe(250);
    expect(change.sales).toBe(0);
  });

  it('leaves a figure with nothing before it as null', () => {
    const change = compareGrowth(figures(), figures({ newCustomers: 0 }));
    expect(change.newCustomers).toBeNull();
  });
});

describe('countFirstPurchases', () => {
  it('counts only first purchases inside the window', () => {
    const from = new Date('2026-10-01T00:00:00Z');
    const to = new Date('2026-11-01T00:00:00Z');
    expect(
      countFirstPurchases(
        [
          new Date('2026-09-15T00:00:00Z'),
          new Date('2026-10-01T00:00:00Z'),
          new Date('2026-10-20T00:00:00Z'),
          new Date('2026-11-01T00:00:00Z'),
        ],
        from,
        to,
      ),
    ).toBe(2);
  });
});
