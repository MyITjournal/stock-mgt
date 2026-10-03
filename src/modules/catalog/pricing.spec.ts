import { resolveUnitPrice } from './pricing';

const HALF_CARTON = { id: 'u-half', name: '1/2 carton', factor: 105 };
const CARTON = { id: 'u-carton', name: 'carton', factor: 210 };

/** Peak 14g at a distributor: the carton is priced, the half carton is not. */
const peak = (basePrice: number | null) => ({
  basePrice,
  taxRateBps: 750,
  prices: [{ tierId: 'wholesale', unitId: 'u-carton', price: 4_000_000 }],
});

describe('resolveUnitPrice', () => {
  it('uses the price list when it has a row for the unit', () => {
    const result = resolveUnitPrice(peak(null), CARTON, 'wholesale');
    expect(result).toMatchObject({ price: 4_000_000, isTierPrice: true });
    expect(result.tax).not.toBeNull();
  });

  it('falls back to base price × factor when there is a base price', () => {
    const result = resolveUnitPrice(peak(2_000), HALF_CARTON, 'wholesale');
    expect(result).toMatchObject({ price: 210_000, isTierPrice: false });
  });

  it('has no price at all — never a guess — when there is no base price', () => {
    // The guess it replaces: 105 sachets × ₦20 = ₦2,100 for a half carton that
    // sells for ₦20,500.
    const result = resolveUnitPrice(peak(null), HALF_CARTON, 'wholesale');
    expect(result.price).toBeNull();
    expect(result.tax).toBeNull();
    expect(result.isTierPrice).toBe(false);
  });

  it('treats a zero base price as a price, not as none', () => {
    // A free sample is a decision somebody made; null is the absence of one.
    const result = resolveUnitPrice(peak(0), HALF_CARTON, 'wholesale');
    expect(result.price).toBe(0);
  });
});
