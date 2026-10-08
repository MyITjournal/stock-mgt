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
      { key: 'lotion', type: 'receipt', reason: null, quantity: 84 },
      {
        key: 'lotion',
        type: 'adjustment',
        reason: 'receipt_correction',
        quantity: -6,
      },
      { key: 'lotion', type: 'sale', reason: null, quantity: -40 },
      { key: 'lotion', type: 'return_in', reason: null, quantity: 2 },
      { key: 'lotion', type: 'damage', reason: 'damage', quantity: -1 },
    ]);

    expect(lines).toEqual([
      {
        key: 'lotion',
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
        key: 'spray',
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
    expect(lines.map((line) => line.key)).toEqual(['still']);
  });

  it('carries value the same way, and reconciles to the stock value', () => {
    // The owner's lotion: 3 opening pieces at ₦4,144.45, then 78 delivered at
    // ₦4,027; 40 sold at the delivery's cost.
    const { lines, totalValue } = summariseStock(new Map(), [
      {
        key: 'lotion',
        type: 'adjustment',
        reason: 'opening_balance',
        quantity: 3,
        value: 3 * 414_445.4,
      },
      {
        key: 'lotion',
        type: 'receipt',
        reason: null,
        quantity: 78,
        value: 78 * 402_700,
      },
      {
        key: 'lotion',
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

  it('gives goods available for sale — opening + delivered, rounded once', () => {
    // ₦0.004 opening and ₦0.004 delivered: each rounds to 0, together to 1.
    const { totalValue, availableValue } = summariseStock(
      new Map([['a', { quantity: 1, value: 0.4 }]]),
      [
        {
          key: 'a',
          type: 'receipt',
          reason: null,
          quantity: 1,
          value: 0.4,
        },
        {
          key: 'a',
          type: 'sale',
          reason: null,
          quantity: -1,
          value: -0.4,
        },
      ],
    );
    expect(totalValue?.opening).toBe(0);
    expect(totalValue?.delivered).toBe(0);
    expect(availableValue).toBe(1);
  });

  it('carries no value when it was not given', () => {
    const summary = summariseStock(new Map([['x', { quantity: 2 }]]), []);
    expect(summary.totalValue).toBeUndefined();
    expect(summary.availableValue).toBeUndefined();
    expect(summary.lines[0]).not.toHaveProperty('value');
  });
});

describe('summariseStock — by option (§24)', () => {
  it('shows stock moving into an option on both rows, and the product still adds up', () => {
    // 100 cartons held before Indomie had options; adding them put all 100 on
    // Chicken (a move on the same lot), and a count spread 60 to the others.
    const { lines } = summariseStock(
      new Map([['indomie', { quantity: 100 }]]),
      [
        { key: 'indomie', type: 'transfer_out', reason: null, quantity: -100 },
        {
          key: 'indomie:chicken',
          type: 'transfer_in',
          reason: null,
          quantity: 100,
        },
        {
          key: 'indomie:chicken',
          type: 'transfer_out',
          reason: 'count_correction',
          quantity: -60,
        },
        {
          key: 'indomie:pepper',
          type: 'transfer_in',
          reason: 'count_correction',
          quantity: 60,
        },
        { key: 'indomie:pepper', type: 'sale', reason: null, quantity: -5 },
      ],
    );

    const byKey = Object.fromEntries(lines.map((line) => [line.key, line]));
    expect(byKey['indomie']).toMatchObject({
      opening: 100,
      adjusted: -100,
      closing: 0,
    });
    expect(byKey['indomie:chicken']).toMatchObject({
      adjusted: 40,
      closing: 40,
    });
    expect(byKey['indomie:pepper']).toMatchObject({
      adjusted: 60,
      sold: 5,
      closing: 55,
    });
    const closing = lines.reduce((sum, line) => sum + line.closing, 0);
    expect(closing).toBe(95);
  });
});
