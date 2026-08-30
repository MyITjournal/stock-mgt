import { splitTaxInclusive } from '../../common/money/money';
import { computeProfit, marginBps } from './profit';

/** A ₦120,000 sale at 7.5% VAT, costing ₦80,000 to buy. */
const sale = {
  total: 12_000_000,
  taxTotal: splitTaxInclusive(12_000_000, 750).tax,
  costTotal: 8_000_000,
};

const nothing = { sales: [], returns: [], expenses: [] };

describe('computeProfit', () => {
  it('reports zeros for a period with nothing in it', () => {
    expect(computeProfit(nothing)).toMatchObject({
      revenue: 0,
      grossProfit: 0,
      operatingProfit: 0,
      marginBps: 0,
    });
  });

  // The rule most likely to be got wrong: the invoice total contains VAT, and
  // VAT was never the shop's money.
  it('excludes VAT from revenue', () => {
    const { revenue, tax, grossSales } = computeProfit({
      ...nothing,
      sales: [sale],
    });

    expect(grossSales).toBe(12_000_000);
    expect(revenue).toBe(12_000_000 - sale.taxTotal);
    expect(revenue + tax).toBe(grossSales);
  });

  it('would overstate margin by the VAT rate if it did not', () => {
    const { grossProfit, marginBps: margin } = computeProfit({
      ...nothing,
      sales: [sale],
    });

    // Honest: (111,627.91 − 80,000) / 111,627.91 ≈ 28.3%.
    expect(grossProfit).toBe(12_000_000 - sale.taxTotal - 8_000_000);
    expect(margin).toBeCloseTo(2833, -1);

    // The naive version, counting the gross as revenue, reads 33.3% — five
    // points of margin that do not exist.
    const naive = marginBps(12_000_000 - 8_000_000, 12_000_000);
    expect(naive).toBe(3333);
    expect(naive).toBeGreaterThan(margin);
  });

  it('subtracts cost of goods sold to get gross profit', () => {
    const { revenue, cogs, grossProfit } = computeProfit({
      ...nothing,
      sales: [sale],
    });
    expect(cogs).toBe(8_000_000);
    expect(grossProfit).toBe(revenue - cogs);
  });

  it('subtracts expenses to get the operating figure', () => {
    const result = computeProfit({
      ...nothing,
      sales: [sale],
      expenses: [{ amount: 1_500_000 }, { amount: 800_000 }],
    });

    expect(result.expenses).toBe(2_300_000);
    expect(result.operatingProfit).toBe(result.grossProfit - 2_300_000);
  });

  describe('returns', () => {
    const halfBack = {
      refundAmount: 6_000_000,
      costAmount: 4_000_000,
      taxRateBps: 750,
    };

    it('unwinds revenue, its VAT, and the cost of the goods', () => {
      const result = computeProfit({
        ...nothing,
        sales: [sale],
        returns: [halfBack],
      });

      const refundTax = splitTaxInclusive(6_000_000, 750).tax;
      expect(result.returned).toBe(6_000_000);
      expect(result.revenue).toBe(
        12_000_000 - sale.taxTotal - (6_000_000 - refundTax),
      );
      expect(result.cogs).toBe(8_000_000 - 4_000_000);
    });

    it('leaves margin roughly intact when half of a sale comes back', () => {
      const whole = computeProfit({ ...nothing, sales: [sale] });
      const halved = computeProfit({
        ...nothing,
        sales: [sale],
        returns: [halfBack],
      });

      // Selling one and taking half back is still the same margin per unit;
      // only the volume changed. Within a basis point of rounding.
      expect(Math.abs(halved.marginBps - whole.marginBps)).toBeLessThanOrEqual(
        1,
      );
      expect(halved.grossProfit).toBeLessThan(whole.grossProfit);
    });

    // The decision from the module header, asserted so it cannot drift: a
    // return is counted where it happened, so a month with only returns in it
    // goes negative rather than reaching back to restate an earlier month.
    it('can drive a period negative on its own', () => {
      const result = computeProfit({ ...nothing, returns: [halfBack] });

      expect(result.revenue).toBeLessThan(0);
      expect(result.cogs).toBe(-4_000_000);
      expect(result.grossProfit).toBeLessThan(0);
    });
  });

  it('adds up across many sales without compounding rounding', () => {
    const sales = Array.from({ length: 500 }, (_, index) => {
      const total = 100_000 + index * 137;
      return {
        total,
        taxTotal: splitTaxInclusive(total, 750).tax,
        costTotal: Math.round(total * 0.6),
      };
    });

    const result = computeProfit({ ...nothing, sales });
    const expectedRevenue = sales.reduce(
      (running, row) => running + row.total - row.taxTotal,
      0,
    );

    expect(result.revenue).toBe(expectedRevenue);
    expect(Number.isInteger(result.revenue)).toBe(true);
    expect(Number.isInteger(result.grossProfit)).toBe(true);
  });
});

describe('marginBps', () => {
  it('is zero on no revenue rather than NaN', () => {
    expect(marginBps(0, 0)).toBe(0);
    expect(marginBps(-5_000, 0)).toBe(0);
  });

  it('reads as basis points', () => {
    expect(marginBps(2_500, 10_000)).toBe(2500);
  });

  it('goes negative when the goods cost more than they sold for', () => {
    expect(marginBps(-1_000, 10_000)).toBe(-1000);
  });
});
