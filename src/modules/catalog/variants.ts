import { BadRequestException } from '@nestjs/common';

/**
 * Product options (variants): Indomie in Chicken, Onion Chicken, Pepper Soup.
 * PRD-V2 §2 and DECISIONS.md §24.
 *
 * Pure, because three places must give the same answer: the product save that
 * writes options, the product-and-unit lookup that names the problem early, and
 * the stock engine that is the actual guarantee — every movement passes it, and
 * not every movement passes the lookup.
 */

/** What a product's options can differ by: "Flavour", or "Flavour" and "Pack size". */
export const MAX_VARIANT_ATTRIBUTES = 2;

/** Trimmed, with runs of spaces collapsed — "  Onion   Chicken " is "Onion Chicken". */
export function cleanVariantText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/**
 * The name an option is shown by: its values joined — "Chicken / 70g".
 *
 * Stored on the row, but only ever written from here, so it cannot disagree
 * with the values it was built from.
 */
export function variantName(values: readonly string[]): string {
  return values.map(cleanVariantText).filter(Boolean).join(' / ');
}

/** What two options of one product may not share: the name, case aside. */
export function variantKey(values: readonly string[]): string {
  return variantName(values).toLowerCase();
}

export interface KnownVariant {
  id: string;
  name: string;
  isActive: boolean;
}

/**
 * Checks the option named on a write against the product's options, and
 * returns it — or null for a product without options.
 *
 * - A product with options must be told which one. Stock of Chicken and stock
 *   of Pepper Soup are different stock; a movement against "Indomie" in
 *   general would land in neither.
 * - A product without options must not be given one.
 * - A **retired** option cannot take new stock or be sold, but its leftover
 *   stock can still be counted, adjusted, moved and returned — otherwise
 *   retiring an option would strand whatever was left on the shelf.
 */
export function checkVariant(
  productName: string,
  variants: readonly KnownVariant[],
  variantId: string | null | undefined,
  options: { allowRetired: boolean },
): KnownVariant | null {
  if (variants.length === 0) {
    if (variantId) {
      throw new BadRequestException(
        `"${productName}" has no options, so none can be named.`,
      );
    }
    return null;
  }

  if (!variantId) {
    throw new BadRequestException(
      `"${productName}" comes in options (${listNames(variants)}). Say which one.`,
    );
  }

  const variant = variants.find((candidate) => candidate.id === variantId);
  if (!variant) {
    throw new BadRequestException(
      `That option does not belong to "${productName}".`,
    );
  }

  if (!variant.isActive && !options.allowRetired) {
    throw new BadRequestException(
      `"${productName} ${variant.name}" is retired, so it cannot be sold or received. Restore it on the product, or choose another option.`,
    );
  }

  return variant;
}

/** Up to four active option names, for a message — enough to recognise the product. */
function listNames(variants: readonly KnownVariant[]): string {
  const active = variants.filter((variant) => variant.isActive);
  const shown = (active.length > 0 ? active : variants).map((v) => v.name);
  return shown.length > 4
    ? `${shown.slice(0, 4).join(', ')} and ${shown.length - 4} more`
    : shown.join(', ');
}
