import { BarcodeSymbology } from '@prisma/client';
import {
  detectSymbology,
  generateInternalCode,
  gs1CheckDigit,
  hasValidCheckDigit,
  normaliseCode,
  requiresCheckDigit,
  resolveBarcode,
} from './barcode';

describe('gs1CheckDigit', () => {
  it('computes the EAN-13 check digit', () => {
    expect(gs1CheckDigit('590123412345')).toBe(7);
  });

  it('computes the UPC-A check digit', () => {
    expect(gs1CheckDigit('03600029145')).toBe(2);
  });
});

describe('hasValidCheckDigit', () => {
  it.each([
    ['5901234123457', 'EAN-13'],
    ['036000291452', 'UPC-A'],
    ['96385074', 'EAN-8'],
  ])('accepts a real %s (%s)', (code) => {
    expect(hasValidCheckDigit(code)).toBe(true);
  });

  it('rejects a transposed digit', () => {
    // 5901234123457 with two digits swapped: the classic typing mistake the
    // check digit exists to catch.
    expect(hasValidCheckDigit('5901234132457')).toBe(false);
  });

  it('rejects a wrong final digit', () => {
    expect(hasValidCheckDigit('5901234123456')).toBe(false);
  });

  it('rejects non-numeric input', () => {
    expect(hasValidCheckDigit('59012341234A7')).toBe(false);
  });

  it('rejects a length that carries no GS1 check digit', () => {
    expect(hasValidCheckDigit('12345')).toBe(false);
  });
});

describe('detectSymbology', () => {
  it.each([
    ['5901234123457', BarcodeSymbology.EAN13],
    ['036000291452', BarcodeSymbology.UPC_A],
    ['96385074', BarcodeSymbology.EAN8],
    ['15901234123457', BarcodeSymbology.ITF14],
  ])('reads %s as %s', (code, expected) => {
    expect(detectSymbology(code)).toBe(expected);
  });

  it('treats a 13-digit code starting with 2 as an internal code', () => {
    // Restricted circulation: printed in-house, not a manufacturer's GTIN.
    expect(detectSymbology('2001234123456')).toBe(BarcodeSymbology.INTERNAL);
  });

  it('falls back to CODE128 for anything else', () => {
    expect(detectSymbology('ABC-123')).toBe(BarcodeSymbology.CODE128);
  });
});

describe('requiresCheckDigit', () => {
  it('is true for GS1 symbologies', () => {
    expect(requiresCheckDigit(BarcodeSymbology.EAN13)).toBe(true);
    expect(requiresCheckDigit(BarcodeSymbology.ITF14)).toBe(true);
  });

  it('is false for free-form symbologies', () => {
    expect(requiresCheckDigit(BarcodeSymbology.CODE128)).toBe(false);
    expect(requiresCheckDigit(BarcodeSymbology.QR)).toBe(false);
  });

  /**
   * An internal code is a real EAN-13 — that is why a scanner reads one — so
   * it is held to the same check digit. It was exempt, which nothing could
   * expose while every internal code was generated; the moment the product
   * form let one be typed, a mistyped code would have been stored looking
   * fine and would simply never have scanned.
   */
  it('is true for an in-house code, which is an EAN-13 underneath', () => {
    expect(requiresCheckDigit(BarcodeSymbology.INTERNAL)).toBe(true);
  });
});

describe('resolveBarcode, on codes in the in-house range', () => {
  /** A 13-digit code starting with 2, with the check digit it should carry. */
  const valid = (body: string) => body + gs1CheckDigit(body).toString();

  it('accepts one whose check digit is right', () => {
    const code = valid('212345678901');
    expect(resolveBarcode({ code })).toEqual({
      code,
      symbology: BarcodeSymbology.INTERNAL,
    });
  });

  it('refuses one whose check digit is wrong', () => {
    const code = valid('212345678901');
    const mistyped = code.slice(0, 12) + ((Number(code[12]) + 1) % 10);

    const result = resolveBarcode({ code: mistyped });
    expect('error' in result).toBe(true);
  });

  it('names it in words a shopkeeper would recognise', () => {
    const code = valid('212345678901');
    const mistyped = code.slice(0, 12) + ((Number(code[12]) + 1) % 10);

    const result = resolveBarcode({ code: mistyped });
    // Not "INTERNAL", which is a word from the schema.
    expect('error' in result && result.error).toContain('in-house barcode');
  });

  it('still accepts a generated one, which is the common case', () => {
    for (let i = 0; i < 50; i++) {
      const result = resolveBarcode({});
      expect('error' in result).toBe(false);
    }
  });
});

describe('generateInternalCode', () => {
  it('produces a scannable EAN-13 with a correct check digit', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateInternalCode();
      expect(code).toHaveLength(13);
      expect(hasValidCheckDigit(code)).toBe(true);
    }
  });

  it('stays inside the restricted-circulation range, never a real GTIN', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateInternalCode().startsWith('2')).toBe(true);
    }
  });

  it('does not repeat', () => {
    const codes = new Set(
      Array.from({ length: 500 }, () => generateInternalCode()),
    );
    expect(codes.size).toBe(500);
  });
});

describe('normaliseCode', () => {
  it('strips the whitespace some scanners append', () => {
    expect(normaliseCode('  5901234 123457 \n')).toBe('5901234123457');
  });
});
