import {
  addTax,
  applyDiscount,
  formatMinor,
  multiply,
  splitTaxInclusive,
  toMajor,
  toMinor,
} from './money';

const VAT_NG = 750; // 7.5%

describe('splitTaxInclusive', () => {
  it('splits a round amount at 7.5%', () => {
    // ₦1,075.00 inclusive -> ₦1,000.00 net + ₦75.00 VAT
    expect(splitTaxInclusive(107_500, VAT_NG)).toEqual({
      gross: 107_500,
      net: 100_000,
      tax: 7_500,
    });
  });

  it('never loses a kobo, whatever the rounding', () => {
    // The property that matters: the parts must sum to the whole, always.
    for (let gross = 1; gross <= 2_000; gross++) {
      const { net, tax } = splitTaxInclusive(gross, VAT_NG);
      expect(net + tax).toBe(gross);
    }
  });

  it('handles an amount whose split does not divide evenly', () => {
    const { gross, net, tax } = splitTaxInclusive(333, VAT_NG);
    expect(net + tax).toBe(gross);
    expect(net).toBe(310);
    expect(tax).toBe(23);
  });

  it('returns the whole amount as net at a zero rate', () => {
    expect(splitTaxInclusive(5_000, 0)).toEqual({
      gross: 5_000,
      net: 5_000,
      tax: 0,
    });
  });

  it('rejects a non-integer amount', () => {
    expect(() => splitTaxInclusive(100.5, VAT_NG)).toThrow(RangeError);
  });

  it('rejects a negative rate', () => {
    expect(() => splitTaxInclusive(100, -1)).toThrow(RangeError);
  });
});

describe('addTax', () => {
  it('is the inverse of splitTaxInclusive for clean amounts', () => {
    expect(addTax(100_000, VAT_NG)).toBe(107_500);
  });
});

describe('multiply', () => {
  it('stays exact where floats would drift', () => {
    // 0.1 + 0.2 territory: 1010 kobo x 3 must be exactly 3030.
    expect(multiply(1_010, 3)).toBe(3_030);
  });

  it('rejects a fractional quantity', () => {
    expect(() => multiply(100, 1.5)).toThrow(RangeError);
  });

  it('rejects a negative quantity', () => {
    expect(() => multiply(100, -1)).toThrow(RangeError);
  });
});

describe('applyDiscount', () => {
  it('takes 10% off', () => {
    expect(applyDiscount(100_000, 1_000)).toBe(90_000);
  });

  it('returns the amount unchanged at zero', () => {
    expect(applyDiscount(12_345, 0)).toBe(12_345);
  });
});

describe('conversion', () => {
  it('round-trips major to minor and back', () => {
    expect(toMinor(25.5)).toBe(2_550);
    expect(toMajor(2_550)).toBe(25.5);
  });

  it('rounds rather than truncating on the way in', () => {
    expect(toMinor(0.005)).toBe(1);
  });
});

describe('formatMinor', () => {
  it('renders naira from kobo', () => {
    // Non-breaking spaces and symbol placement vary by ICU build, so assert on
    // the digits rather than the exact string.
    expect(formatMinor(250_000, 'NGN')).toContain('2,500.00');
  });
});
