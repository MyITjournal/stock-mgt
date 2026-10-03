import { BadRequestException } from '@nestjs/common';
import { BusinessType } from '@prisma/client';
import {
  chooseDefaultSellingUnit,
  defaultIsSellable,
  type SettledUnit,
} from './selling-units';

const { retail, wholesale, mixed } = BusinessType;

/** Peak 14g: counted in sachets, sold from the roll up. */
const PEAK_14G = [
  { name: 'sachet', factor: 1 },
  { name: 'roll', factor: 10 },
  { name: '1/6 carton', factor: 35 },
  { name: '1/2 carton', factor: 105 },
  { name: 'carton', factor: 210 },
];

function settled(
  shape: { name: string; factor: number }[],
  overrides: Partial<Record<string, Partial<SettledUnit>>> = {},
): SettledUnit[] {
  return shape.map((unit) => ({
    id: `id-${unit.name}`,
    isSellable: true,
    isDefaultSelling: false,
    ...unit,
    ...overrides[unit.name],
  }));
}

describe('defaultIsSellable', () => {
  it("leaves a wholesaler's base unit unsold — it counts sachets, it does not sell them", () => {
    expect(defaultIsSellable(PEAK_14G[0], PEAK_14G.length, wholesale)).toBe(
      false,
    );
  });

  it('sells every bigger unit for a wholesaler', () => {
    for (const unit of PEAK_14G.slice(1)) {
      expect(defaultIsSellable(unit, PEAK_14G.length, wholesale)).toBe(true);
    }
  });

  it('sells the base unit for a retail shop and a shop doing both', () => {
    expect(defaultIsSellable(PEAK_14G[0], PEAK_14G.length, retail)).toBe(true);
    expect(defaultIsSellable(PEAK_14G[0], PEAK_14G.length, mixed)).toBe(true);
  });

  it("always sells a product's only unit, even for a wholesaler", () => {
    // A delivery charge counted in trips has nothing else to sell.
    expect(defaultIsSellable({ name: 'trip', factor: 1 }, 1, wholesale)).toBe(
      true,
    );
  });
});

describe('chooseDefaultSellingUnit', () => {
  it('refuses a product with nothing sold at the till', () => {
    const units = settled(PEAK_14G, {
      sachet: { isSellable: false },
      roll: { isSellable: false },
      '1/6 carton': { isSellable: false },
      '1/2 carton': { isSellable: false },
      carton: { isSellable: false },
    });
    expect(() => chooseDefaultSellingUnit(units, undefined, mixed)).toThrow(
      BadRequestException,
    );
  });

  it('takes the unit the caller asked for', () => {
    const units = settled(PEAK_14G);
    expect(chooseDefaultSellingUnit(units, 'roll', mixed)).toBe('id-roll');
  });

  it('refuses an unsold unit as the default rather than quietly overriding it', () => {
    const units = settled(PEAK_14G, { sachet: { isSellable: false } });
    expect(() => chooseDefaultSellingUnit(units, 'sachet', wholesale)).toThrow(
      /not sold at the till/,
    );
  });

  it('keeps the current default while it is still sold', () => {
    const units = settled(PEAK_14G, { roll: { isDefaultSelling: true } });
    expect(chooseDefaultSellingUnit(units, undefined, wholesale)).toBe(
      'id-roll',
    );
  });

  it('moves the default off a unit that has just stopped being sold', () => {
    const units = settled(PEAK_14G, {
      sachet: { isSellable: false, isDefaultSelling: true },
    });
    // Mixed picks the smallest unit still sold.
    expect(chooseDefaultSellingUnit(units, undefined, mixed)).toBe('id-roll');
  });

  it('starts a wholesaler on its biggest unit — it sells by the carton', () => {
    const units = settled(PEAK_14G, { sachet: { isSellable: false } });
    expect(chooseDefaultSellingUnit(units, undefined, wholesale)).toBe(
      'id-carton',
    );
  });

  it('starts anyone else on the smallest unit sold', () => {
    const units = settled([
      { name: 'piece', factor: 1 },
      { name: '1/4 carton', factor: 3 },
      { name: 'carton', factor: 12 },
    ]);
    expect(chooseDefaultSellingUnit(units, undefined, retail)).toBe('id-piece');
  });
});
