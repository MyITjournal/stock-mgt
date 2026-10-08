import { duplicateWindow, sameItems, WALK_IN_WINDOW_MS } from './duplicates';

const LAGOS = 'Africa/Lagos';

describe('duplicateWindow', () => {
  // 10:42 on 8 October, Lagos (UTC+1).
  const at = new Date('2026-10-08T09:42:00Z');

  it('is the whole day, in the shop’s zone, for a named customer', () => {
    expect(duplicateWindow('customer-1', at, LAGOS)).toEqual({
      from: new Date('2026-10-07T23:00:00Z'),
      to: new Date('2026-10-08T23:00:00Z'),
    });
  });

  it('is ten minutes either side for a walk-in', () => {
    const window = duplicateWindow(null, at, LAGOS);
    expect(window.from).toEqual(new Date(at.getTime() - WALK_IN_WINDOW_MS));
    expect(window.to.getTime()).toBeGreaterThan(
      at.getTime() + WALK_IN_WINDOW_MS,
    );
  });

  it('follows a sale dated to an earlier day', () => {
    const yesterday = new Date('2026-10-07T12:00:00Z');
    expect(duplicateWindow('customer-1', yesterday, LAGOS).from).toEqual(
      new Date('2026-10-06T23:00:00Z'),
    );
  });
});

describe('sameItems', () => {
  const peak = { productId: 'peak', unitId: 'carton', quantity: 2 };
  const milo = { productId: 'milo', unitId: 'piece', quantity: 6 };

  it('matches the same goods in any order, prices aside', () => {
    expect(sameItems([peak, milo], [milo, peak])).toBe(true);
  });

  it('does not match a different quantity or an extra line', () => {
    expect(sameItems([peak], [{ ...peak, quantity: 3 }])).toBe(false);
    expect(sameItems([peak], [peak, milo])).toBe(false);
  });

  it('does not match the same product in a different unit', () => {
    expect(sameItems([peak], [{ ...peak, unitId: 'piece' }])).toBe(false);
  });

  it('adds two lines of one product together', () => {
    expect(
      sameItems(
        [
          { ...peak, quantity: 1 },
          { ...peak, quantity: 1 },
        ],
        [peak],
      ),
    ).toBe(true);
  });

  it('ignores units when the request left the unit to the server', () => {
    expect(sameItems([{ productId: 'peak', quantity: 2 }], [peak])).toBe(true);
  });
});
