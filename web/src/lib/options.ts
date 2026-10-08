/**
 * A product and its option as one name — "Eva Soap — Gold" — the way the
 * receipt and invoice print it (`optionLabel` in the API's `variants.ts`).
 * Just the product's name when there is no option.
 */
export function optionLabel(
  productName: string,
  optionName?: string | null,
): string {
  return optionName ? `${productName} — ${optionName}` : productName;
}

/** "Chicken / 70g" — how the API names an option from its values. */
export function draftName(values: readonly string[]): string {
  return values
    .map((value) => value.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join(' / ');
}

/** The query string that asks for an option's price, or nothing. */
export function optionQuery(variantId?: string | null): string {
  return variantId ? `&variantId=${variantId}` : '';
}
