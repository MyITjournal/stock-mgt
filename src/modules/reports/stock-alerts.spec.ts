import { stockAlerts, type AlertProduct } from './stock-alerts';

const indomie: AlertProduct = {
  id: 'indomie',
  name: 'Indomie',
  sku: 'INDOMIE',
  reorderPoint: 5,
  units: [
    { name: 'pack', factor: 1 },
    { name: 'carton', factor: 40 },
  ],
  variants: [
    { id: 'chicken', name: 'Chicken', isActive: true },
    { id: 'pepper', name: 'Pepper Soup', isActive: true },
    { id: 'onion', name: 'Onion', isActive: true },
    { id: 'curry', name: 'Curry', isActive: false },
  ],
};

const peak: AlertProduct = {
  id: 'peak',
  name: 'Peak',
  sku: 'PEAK',
  reorderPoint: null,
  units: [{ name: 'tin', factor: 1 }],
  variants: [],
};

describe('stockAlerts', () => {
  it('checks each option against the product’s level on its own', () => {
    // 50 cartons in all — healthy, summed — but Pepper Soup is down to 3.
    const alerts = stockAlerts(
      [indomie],
      [
        { productId: 'indomie', variantId: 'chicken', quantity: 30 },
        { productId: 'indomie', variantId: 'chicken', quantity: 17 },
        { productId: 'indomie', variantId: 'pepper', quantity: 3 },
      ],
    );

    expect(alerts.lowStock).toEqual([
      expect.objectContaining({
        id: 'indomie',
        variant: { id: 'pepper', name: 'Pepper Soup' },
        quantity: 3,
        // So the screen can say it in cartons as well as packs (2026-10-09).
        units: indomie.units,
      }),
    ]);
    // Onion has none; Curry has none too but is retired, so is not "out".
    expect(alerts.outOfStock.map((row) => row.variant?.name)).toEqual([
      'Onion',
    ]);
  });

  it('lists a retired option only when it is negative', () => {
    const alerts = stockAlerts(
      [indomie],
      [
        { productId: 'indomie', variantId: 'chicken', quantity: 10 },
        { productId: 'indomie', variantId: 'pepper', quantity: 10 },
        { productId: 'indomie', variantId: 'onion', quantity: 10 },
        { productId: 'indomie', variantId: 'curry', quantity: -2 },
      ],
    );
    expect(alerts.negative.map((row) => row.variant?.name)).toEqual(['Curry']);
    expect(alerts.outOfStock).toEqual([]);
  });

  it('keeps one row for a product without options, and counts levels by product', () => {
    const alerts = stockAlerts([indomie, peak], []);
    expect(alerts.outOfStock.filter((row) => row.id === 'peak')).toEqual([
      expect.objectContaining({ variant: null, quantity: 0 }),
    ]);
    expect(alerts.withoutReorderPoint).toBe(1);
  });
});

describe('running low, from how fast it sells (2026-10-09)', () => {
  // Milo 20g, counted in rolls: 12 rolls to a carton.
  const milo: AlertProduct = {
    id: 'milo',
    name: 'Milo 20g',
    sku: 'MILO20',
    reorderPoint: null,
    units: [
      { name: 'roll', factor: 1 },
      { name: 'carton', factor: 12 },
    ],
    variants: [],
  };
  const holding = (quantity: number, productId = 'milo') => [
    { productId, variantId: null, quantity },
  ];
  const selling = (sold: number, days: number, productId = 'milo') => [
    { productId, variantId: null, sold, days },
  ];

  it('flags the owner’s Milo with no level typed in', () => {
    // Three cartons (36 rolls) in on the 1st; five rolls left on the 12th, so
    // 31 sold in 12 days — about 2.6 a day. Five rolls is about one day's worth.
    const alerts = stockAlerts([milo], holding(5), selling(31, 12), 7);

    expect(alerts.lowStock).toEqual([
      expect.objectContaining({
        id: 'milo',
        quantity: 5,
        reason: 'running_out',
        daysLeft: 1,
        soldInWindow: 31,
        windowDays: 12,
      }),
    ]);
  });

  it('leaves alone stock that will last the warning period', () => {
    // Thirty rolls at 2.6 a day is eleven days.
    const alerts = stockAlerts([milo], holding(30), selling(31, 12), 7);
    expect(alerts.lowStock).toEqual([]);
  });

  it('is low only when the stock will not last the whole period', () => {
    // A roll a day: seven rolls last exactly seven days, six do not.
    expect(stockAlerts([milo], holding(7), selling(7, 7), 7).lowStock).toEqual(
      [],
    );
    expect(
      stockAlerts([milo], holding(6), selling(7, 7), 7).lowStock,
    ).toHaveLength(1);
  });

  it('uses the shop’s own number of days', () => {
    expect(stockAlerts([milo], holding(6), selling(7, 7), 3).lowStock).toEqual(
      [],
    );
  });

  it('still honours a level somebody typed in, for an item that has not sold', () => {
    const alerts = stockAlerts(
      [{ ...milo, reorderPoint: 10 }],
      holding(8),
      [],
      7,
    );
    expect(alerts.lowStock).toEqual([
      expect.objectContaining({ reason: 'below_level', daysLeft: null }),
    ]);
  });

  it('lists the soonest gone first, and typed levels after', () => {
    const tea = { ...milo, id: 'tea', reorderPoint: 50 };
    const sugar = { ...milo, id: 'sugar' };
    const alerts = stockAlerts(
      [tea, milo, sugar],
      [...holding(20, 'tea'), ...holding(5), ...holding(2, 'sugar')],
      [...selling(31, 12), ...selling(30, 30, 'sugar')],
      7,
    );
    // Sugar: 2 left at 1 a day; Milo: 5 at 2.6 a day; tea only below its level.
    expect(alerts.lowStock.map((row) => row.id)).toEqual([
      'milo',
      'sugar',
      'tea',
    ]);
    expect(alerts.lowStock.map((row) => row.daysLeft)).toEqual([1, 2, null]);
  });

  it('counts what really left — more returned than sold is nothing sold', () => {
    const alerts = stockAlerts([milo], holding(5), selling(-3, 12), 7);
    expect(alerts.lowStock).toEqual([]);
  });

  it('measures each option on its own', () => {
    const alerts = stockAlerts(
      [indomie],
      [
        { productId: 'indomie', variantId: 'chicken', quantity: 40 },
        { productId: 'indomie', variantId: 'pepper', quantity: 40 },
      ],
      [
        // Chicken flies off the shelf; Pepper Soup barely moves.
        { productId: 'indomie', variantId: 'chicken', sold: 300, days: 30 },
        { productId: 'indomie', variantId: 'pepper', sold: 30, days: 30 },
      ],
      7,
    );
    expect(alerts.lowStock.map((row) => row.variant?.name)).toEqual([
      'Chicken',
    ]);
  });

  it('never calls a retired option low, however fast it sold', () => {
    const alerts = stockAlerts(
      [indomie],
      [{ productId: 'indomie', variantId: 'curry', quantity: 1 }],
      [{ productId: 'indomie', variantId: 'curry', sold: 300, days: 30 }],
      7,
    );
    expect(alerts.lowStock.some((row) => row.variant?.id === 'curry')).toBe(
      false,
    );
  });
});
