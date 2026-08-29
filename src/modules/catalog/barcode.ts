import { BarcodeSymbology } from '@prisma/client';
import * as crypto from 'crypto';

/**
 * GS1 barcode helpers.
 *
 * EAN-13, UPC-A, EAN-8 and ITF-14 all share one check-digit rule: working
 * right-to-left from the digit before the check digit, weight the digits
 * 3, 1, 3, 1, ... sum them, and the check digit is whatever brings the total
 * to a multiple of ten. Implementing it once covers all four.
 */

/** Lengths that carry a GS1 check digit, keyed by the symbology they imply. */
const GS1_LENGTHS: Record<number, BarcodeSymbology> = {
  8: BarcodeSymbology.EAN8,
  12: BarcodeSymbology.UPC_A,
  13: BarcodeSymbology.EAN13,
  14: BarcodeSymbology.ITF14,
};

/**
 * GS1 reserves numbers starting with 2 for "restricted circulation" — codes a
 * business prints for itself. Generating in that range means an internal label
 * can never collide with a real manufacturer's GTIN.
 */
const INTERNAL_PREFIX = '2';

export function isDigits(code: string): boolean {
  return /^\d+$/.test(code);
}

/** The check digit `dataDigits` should end with. */
export function gs1CheckDigit(dataDigits: string): number {
  let sum = 0;

  for (let i = 0; i < dataDigits.length; i++) {
    // Rightmost data digit gets weight 3, then alternate.
    const fromRight = dataDigits.length - 1 - i;
    const weight = fromRight % 2 === 0 ? 3 : 1;
    sum += Number(dataDigits[i]) * weight;
  }

  return (10 - (sum % 10)) % 10;
}

/**
 * True when `code` is a well-formed GS1 number of a length that carries a check
 * digit. Codes of other lengths are not GS1 and are not judged here.
 */
export function hasValidCheckDigit(code: string): boolean {
  if (!isDigits(code) || !(code.length in GS1_LENGTHS)) return false;

  const data = code.slice(0, -1);
  const check = Number(code.slice(-1));
  return gs1CheckDigit(data) === check;
}

/**
 * Best guess at what kind of barcode this is, from its shape.
 *
 * The caller may override it; this only saves the user picking from a list for
 * the common case of scanning a printed GTIN.
 */
export function detectSymbology(code: string): BarcodeSymbology {
  const trimmed = code.trim();

  if (isDigits(trimmed) && trimmed.length in GS1_LENGTHS) {
    const symbology = GS1_LENGTHS[trimmed.length];
    // A 13-digit code starting with 2 is a restricted-circulation number,
    // i.e. one somebody printed in-house rather than a manufacturer's GTIN.
    if (
      symbology === BarcodeSymbology.EAN13 &&
      trimmed.startsWith(INTERNAL_PREFIX)
    ) {
      return BarcodeSymbology.INTERNAL;
    }
    return symbology;
  }

  return BarcodeSymbology.CODE128;
}

/** Symbologies whose codes must satisfy the GS1 check digit. */
export function requiresCheckDigit(symbology: BarcodeSymbology): boolean {
  return (
    symbology === BarcodeSymbology.EAN13 ||
    symbology === BarcodeSymbology.EAN8 ||
    symbology === BarcodeSymbology.UPC_A ||
    symbology === BarcodeSymbology.ITF14
  );
}

/**
 * A valid EAN-13 in the restricted-circulation range, for the many FMCG items
 * that arrive with no barcode — loose goods, repacks, local products.
 *
 * It is a real EAN-13, so any scanner reads it and any label printer prints it;
 * the leading 2 keeps it out of the manufacturer-assigned space.
 */
export function generateInternalCode(): string {
  let body = INTERNAL_PREFIX;
  for (let i = 0; i < 11; i++) {
    body += crypto.randomInt(0, 10).toString();
  }
  return body + gs1CheckDigit(body).toString();
}

/** Normalises a scanned code: trims, and drops the spaces some scanners insert. */
export function normaliseCode(code: string): string {
  return code.trim().replace(/\s+/g, '');
}
