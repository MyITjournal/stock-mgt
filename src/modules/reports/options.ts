import { optionLabel } from '../catalog/variants';

/**
 * Reports by option (DECISIONS.md §24, branch 5). Owner, 2026-10-08: "each
 * variant is to be handled as an item" — so wherever a report has a row per
 * product, it has a row per **option** instead: "Eva Soap — Gold".
 *
 * A product that has options can still have rows that name none: what it sold,
 * received or held **before** it had options. Those keep their own row,
 * labelled so nobody reads "Indomie" as an eleventh flavour.
 */

/** A row's key: the product's id, or the product's and the option's. */
export function itemKey(
  productId: string,
  variantId: string | null | undefined,
): string {
  return variantId ? `${productId}:${variantId}` : productId;
}

/**
 * "Eva Soap — Gold"; "Indomie (before options)" for a row naming no option of a
 * product that now has them; otherwise just the name.
 */
export function itemLabel(
  product: { name: string; variants?: readonly unknown[] },
  variant: { name: string } | null | undefined,
): string {
  if (variant) return optionLabel(product.name, variant.name);
  return product.variants?.length
    ? `${product.name} (before options)`
    : product.name;
}

/** Enough of a product's options to tell whether it has any. */
export const HAS_OPTIONS = { select: { id: true }, take: 1 } as const;

/** The option as a report row names it. */
export const OPTION_REF = { select: { id: true, name: true } } as const;
