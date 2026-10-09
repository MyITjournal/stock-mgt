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
