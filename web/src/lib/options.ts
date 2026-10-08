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

/** One thing that can come into stock: a product, or one option of it. */
export interface StockChoice<P> {
  /** `productId`, or `productId/variantId` — unique, for a select's value. */
  value: string;
  product: P;
  variantId: string | null;
  /** "Gold", or null. */
  optionName: string | null;
  /** "Eva Soap — Gold", or just "Eva Soap". */
  label: string;
}

/**
 * What a delivery can bring in: **one choice per active option** of a product
 * with options — to stock, as to the till, an option is an item of its own
 * (DECISIONS.md §24) — and one per product without. Retired options are left
 * out: they take no new stock.
 */
export function stockChoices<
  P extends {
    id: string;
    name: string;
    variants: readonly { id: string; name: string; isActive: boolean }[];
  },
>(products: readonly P[]): StockChoice<P>[] {
  return products.flatMap((product): StockChoice<P>[] =>
    product.variants.length === 0
      ? [
          {
            value: product.id,
            product,
            variantId: null,
            optionName: null,
            label: product.name,
          },
        ]
      : product.variants
          .filter((variant) => variant.isActive)
          .map((variant) => ({
            value: `${product.id}/${variant.id}`,
            product,
            variantId: variant.id,
            optionName: variant.name,
            label: optionLabel(product.name, variant.name),
          })),
  );
}

/** The value `stockChoices` gives a product and option. */
export function choiceValue(productId: string, variantId?: string | null) {
  return variantId ? `${productId}/${variantId}` : productId;
}
