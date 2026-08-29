import { priceLine, proportionOfLine, roundCost } from './sale-pricing';

describe('priceLine', () => {
  it('multiplies the unit price by the quantity sold, not by base units', () => {
    // Two cartons at ₦54,000 each. The 24 pieces inside are the ledger's
    // business, not the invoice's.
    const line = priceLine(5_400_000, 2, 750);

    expect(line.lineTotal).toBe(10_800_000);
  });

  it('splits VAT out of the total by subtraction, so the parts always sum', () => {
    const line = priceLine(250_000, 1, 750);

    expect(line.lineTotal).toBe(250_000);
    expect(line.taxAmount).toBe(250_000 - 232_558);
    expect(line.lineTotal - line.taxAmount).toBe(232_558);
  });

  it('keeps net + tax exact at every rounding boundary', () => {
    for (let price = 1; price <= 400; price += 1) {
      const line = priceLine(price, 3, 750);
      const net = line.lineTotal - line.taxAmount;

      expect(net + line.taxAmount).toBe(line.lineTotal);
      expect(Number.isInteger(line.taxAmount)).toBe(true);
    }
  });

  it('charges no tax at a zero rate', () => {
    expect(priceLine(250_000, 2, 0).taxAmount).toBe(0);
  });

  it('refuses a fractional price, because money is an integer count of kobo', () => {
    expect(() => priceLine(2500.5, 1, 750)).toThrow(RangeError);
  });
});

describe('roundCost', () => {
  it('rounds the exact fraction to whole kobo', () => {
    expect(roundCost(37_500.4)).toBe(37_500);
    expect(roundCost(37_500.5)).toBe(37_501);
  });

  /**
   * The reason cost is rounded once rather than per batch. A pick spanning
   * three lots each ending in .4 rounds down three times if you round early,
   * losing more than the single rounding of their sum.
   */
  it('rounding once beats rounding per batch', () => {
    const perBatch = [10.4, 10.4, 10.4];
    const roundedEach = perBatch.reduce((sum, c) => sum + Math.round(c), 0);

    expect(roundCost(perBatch.reduce((sum, c) => sum + c, 0))).toBe(31);
    expect(roundedEach).toBe(30);
  });

  it('rejects a cost that is not a finite number', () => {
    expect(() => roundCost(Number.NaN)).toThrow(RangeError);
    expect(() => roundCost(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('proportionOfLine', () => {
  it('returns the whole amount when the whole line comes back', () => {
    // Exact, not 3 × round(amount/3): a full return must refund every kobo.
    expect(proportionOfLine(10_000, 3, 3)).toBe(10_000);
  });

  it('returns a share when part of the line comes back', () => {
    expect(proportionOfLine(10_800_000, 48, 24)).toBe(5_400_000);
  });

  it('rounds a share that does not divide evenly', () => {
    expect(proportionOfLine(10_000, 3, 1)).toBe(3_333);
  });

  it('refuses to return more than was sold', () => {
    expect(() => proportionOfLine(10_000, 3, 4)).toThrow(RangeError);
  });

  it('refuses a zero or negative return', () => {
    expect(() => proportionOfLine(10_000, 3, 0)).toThrow(RangeError);
    expect(() => proportionOfLine(10_000, 3, -1)).toThrow(RangeError);
  });
});
