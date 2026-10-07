import { columnFor, summariseStock } from './stock-summary';

describe('columnFor', () => {
  it('puts each kind of movement in one column', () => {
    expect(columnFor('adjustment', 'opening_balance')).toBe('opening');
    expect(columnFor('receipt', null)).toBe('delivered');
    expect(columnFor('adjustment', 'receipt_correction')).toBe('delivered');
    expect(columnFor('sale', null)).toBe('sold');
    expect(columnFor('return_in', null)).toBe('sold');
    expect(columnFor('damage', 'damage')).toBe('adjusted');
    expect(columnFor('adjustment', 'count_correction')).toBe('adjusted');
    expect(columnFor('transfer_out', null)).toBe('adjusted');
    expect(columnFor('return_out', null)).toBe('adjusted');
  });
});

describe('summariseStock', () => {
  it('adds up: opening + delivered − sold ± adjusted = total', () => {
    // 3 lotions from before; 78 delivered, 6 of them never came; 40 sold,
    // 2 brought back; 1 broken.
    const { lines } = summariseStock(new Map([['lotion', { quantity: 3 }]]), [
      { productId: 'lotion', type: 'receipt', reason: null, quantity: 84 },
      {
        productId: 'lotion',
        type: 'adjustment',
        reason: 'receipt_correction',
        quantity: -6,
      },
      { productId: 'lotion', type: 'sale', reason: null, quantity: -40 },
      { productId: 'lotion', type: 'return_in', reason: null, quantity: 2 },
      { productId: 'lotion', type: 'damage', reason: 'damage', quantity: -1 },
    ]);

    expect(lines).toEqual([
      {
        productId: 'lotion',
        opening: 3,
        delivered: 78,
        sold: 38,
        adjusted: -1,
        closing: 42,
      },
    ]);
  });

  it('counts opening stock entered during the period as opening', () => {
    const { lines } = summariseStock(new Map(), [
      {
        productId: 'spray',
        type: 'adjustment',
        reason: 'opening_balance',
        quantity: 21,
      },
    ]);
    expect(lines[0]).toMatchObject({ opening: 21, closing: 21, adjusted: 0 });
  });

  it('keeps a product with stock and no movement, and drops one with neither', () => {
    const { lines } = summariseStock(
      new Map([
        ['still', { quantity: 12 }],
        ['gone', { quantity: 0 }],
      ]),
      [],
    );
    expect(lines.map((line) => line.productId)).toEqual(['still']);
  });

  it('carries value the same way, and reconciles to the stock value', () => {
    // The owner's lotion: 3 opening pieces at ₦4,144.45, then 78 delivered at
    // ₦4,027; 40 sold at the delivery's cost.
    const { lines, totalValue } = summariseStock(new Map(), [
      {
        productId: 'lotion',
        type: 'adjustment',
        reason: 'opening_balance',
        quantity: 3,
        value: 3 * 414_445.4,
      },
      {
        productId: 'lotion',
        type: 'receipt',
        reason: null,
        quantity: 78,
        value: 78 * 402_700,
      },
      {
        productId: 'lotion',
        type: 'sale',
        reason: null,
        quantity: -40,
        value: -40 * 402_700,
      },
    ]);

    expect(lines[0].value).toEqual({
      opening: 1_243_336,
      delivered: 31_410_600,
      sold: 16_108_000,
      adjusted: 0,
      closing: 16_545_936,
    });
    expect(totalValue).toEqual(lines[0].value);
  });

  it('rounds the total from the exact sum, not from rounded lines', () => {
    // Two products each worth half a kobo: lines round to 1 each, the total
    // to 1, not 2.
    const { lines, totalValue } = summariseStock(
      new Map([
        ['a', { quantity: 1, value: 0.5 }],
        ['b', { quantity: 1, value: 0.4 }],
      ]),
      [],
    );
    expect(lines.map((line) => line.value?.closing)).toEqual([1, 0]);
    expect(totalValue?.closing).toBe(1);
  });

  it('carries no value when it was not given', () => {
    const summary = summariseStock(new Map([['x', { quantity: 2 }]]), []);
    expect(summary.totalValue).toBeUndefined();
    expect(summary.lines[0]).not.toHaveProperty('value');
  });
});
