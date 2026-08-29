import { BadRequestException } from '@nestjs/common';
import { assertExactlyOneBaseUnit, generateSku } from './product.service';

describe('assertExactlyOneBaseUnit', () => {
  it('accepts a piece/pack/carton hierarchy with one base', () => {
    expect(() =>
      assertExactlyOneBaseUnit([
        { name: 'piece', factor: 1 },
        { name: 'pack', factor: 12 },
        { name: 'carton', factor: 24 },
      ]),
    ).not.toThrow();
  });

  it('rejects a product with no base unit', () => {
    // Without a factor-1 unit there is nothing to count stock in, so the
    // Slice 3 ledger would have no anchor.
    expect(() =>
      assertExactlyOneBaseUnit([
        { name: 'pack', factor: 12 },
        { name: 'carton', factor: 24 },
      ]),
    ).toThrow(BadRequestException);
  });

  it('rejects two units both claiming to be the base', () => {
    expect(() =>
      assertExactlyOneBaseUnit([
        { name: 'piece', factor: 1 },
        { name: 'sachet', factor: 1 },
      ]),
    ).toThrow(/Only one unit may have factor 1/);
  });

  it('rejects duplicate unit names regardless of case', () => {
    expect(() =>
      assertExactlyOneBaseUnit([
        { name: 'piece', factor: 1 },
        { name: 'Piece', factor: 12 },
      ]),
    ).toThrow(/unique/i);
  });

  it('accepts a single-unit product', () => {
    expect(() =>
      assertExactlyOneBaseUnit([{ name: 'piece', factor: 1 }]),
    ).not.toThrow();
  });
});

describe('generateSku', () => {
  it('derives a SKU from the product name', () => {
    expect(generateSku('Peak Milk 400g')).toBe('PEAK-MILK-400G');
  });

  it('collapses punctuation and trims separators', () => {
    expect(generateSku('  Indomie (Chicken) — 70g  ')).toBe(
      'INDOMIE-CHICKEN-70G',
    );
  });

  it('falls back when the name has nothing usable', () => {
    expect(generateSku('!!!')).toBe('PRODUCT');
  });

  it('caps the length', () => {
    expect(generateSku('a'.repeat(100)).length).toBeLessThanOrEqual(48);
  });
});
