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
  it('adds up: opening + delivered − sold ± adjusted = at the end', () => {
    // 3 lotions from before; 78 delivered, 6 of them never came; 40 sold,
    // 2 brought back; 1 broken.
    const [line] = summariseStock(new Map([['lotion', 3]]), [
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

    expect(line).toEqual({
      productId: 'lotion',
      opening: 3,
      delivered: 78,
      sold: 38,
      adjusted: -1,
      closing: 42,
    });
    expect(line.opening + line.delivered - line.sold + line.adjusted).toBe(
      line.closing,
    );
  });

  it('counts opening stock entered during the period as opening', () => {
    const [line] = summariseStock(new Map(), [
      {
        productId: 'spray',
        type: 'adjustment',
        reason: 'opening_balance',
        quantity: 21,
      },
    ]);
    expect(line).toMatchObject({ opening: 21, closing: 21, adjusted: 0 });
  });

  it('keeps a product with stock and no movement, and drops one with neither', () => {
    const lines = summariseStock(
      new Map([
        ['still', 12],
        ['gone', 0],
      ]),
      [],
    );
    expect(lines.map((line) => line.productId)).toEqual(['still']);
  });
});
