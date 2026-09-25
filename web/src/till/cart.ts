import { previewLineTotal, type Minor } from '../lib/money';

/**
 * The cart, as plain data and pure functions over it.
 *
 * Kept out of the component because a till is the one screen where the rules
 * are worth reading on their own: what merges with what, what a price override
 * means, and which number is a preview rather than a fact.
 *
 * **Nothing here computes money except `previewLineTotal`**, and that is exact:
 * both operands are integers and prices are stored tax-inclusive, so there is
 * no tax to split and nothing to round (DECISIONS.md §2, §17). VAT, cost of
 * goods sold and the invoice total are the server's, and the receipt renders
 * what it sends back. A preview that disagrees with the receipt is a bug, not a
 * rounding difference.
 */

export interface UnitOption {
  id: string;
  name: string;
  factor: number;
}

export interface CartLine {
  /** Local identity, so React and the editors have something stable to hold. */
  key: string;
  /**
   * The id this line will carry on the server, minted here and kept.
   *
   * Client-supplied row identity is the §8 offline rule, and it is what makes a
   * retry safe: the same sale sent twice is the same `id` twice, not two sales.
   * It must therefore be stable for the life of the cart — minting a fresh one
   * per attempt would turn an override retry into a second, different sale.
   */
  saleLineId: string;
  productId: string;
  productName: string;
  sku: string;
  unitId: string;
  unitName: string;
  /** Every unit this product sells in, for the picker. */
  units: UnitOption[];
  quantity: number;
  /** What this line will be charged at, in kobo. */
  unitPrice: Minor;
  /**
   * What the price list said before anyone touched it.
   *
   * Kept so the screen can show that a price was overridden and offer to put it
   * back. The override itself is not a discount percentage: a rep who settled
   * on ₦4,900 over the phone types ₦4,900, which is a number that reconciles
   * later rather than one nobody can explain (§4).
   */
  listPrice: Minor;
  /**
   * False when no tier priced this unit and the price fell back to
   * `basePrice × factor` — right for a sachet, wrong for a carton. The till
   * flags it, because that fallback silently overcharging a walk-in is the bug
   * the per-unit price list exists to prevent (§4).
   */
  isTierPrice: boolean;
}

export function lineTotal(line: CartLine): Minor {
  return previewLineTotal(line.unitPrice, line.quantity);
}

export function cartTotal(lines: readonly CartLine[]): Minor {
  return lines.reduce((total, line) => total + lineTotal(line), 0);
}

export function isOverridden(line: CartLine): boolean {
  return line.unitPrice !== line.listPrice;
}

/**
 * Adds goods to the cart, merging with a line already holding the same thing.
 *
 * Merging matters more than it looks: scanning a carton four times is how a
 * till is actually used, and four separate lines of one each is a receipt
 * nobody wants to read. Lines merge only when the product, the unit **and** the
 * price all match — a line whose price was overridden is a different agreement
 * and stays on its own.
 */
export function addToCart(
  lines: readonly CartLine[],
  incoming: Omit<CartLine, 'key' | 'saleLineId'>,
  quantity = 1,
): CartLine[] {
  const match = lines.findIndex(
    (line) =>
      line.productId === incoming.productId &&
      line.unitId === incoming.unitId &&
      line.unitPrice === incoming.unitPrice,
  );

  if (match >= 0) {
    return lines.map((line, index) =>
      index === match
        ? { ...line, quantity: line.quantity + quantity }
        : line,
    );
  }

  return [
    ...lines,
    {
      ...incoming,
      key: crypto.randomUUID(),
      saleLineId: crypto.randomUUID(),
      quantity,
    },
  ];
}

export function updateLine(
  lines: readonly CartLine[],
  key: string,
  change: Partial<Omit<CartLine, 'key' | 'saleLineId'>>,
): CartLine[] {
  return lines.map((line) =>
    line.key === key ? { ...line, ...change } : line,
  );
}

export function removeLine(
  lines: readonly CartLine[],
  key: string,
): CartLine[] {
  return lines.filter((line) => line.key !== key);
}

/**
 * The lines as `POST /sales` wants them.
 *
 * **`unitPrice` is always sent, never left for the server to resolve.** The
 * till has already shown a price and very likely said it out loud, so that is
 * the price the customer pays; letting the server re-derive it would let the
 * receipt disagree with the screen for reasons nobody in the shop can see. It
 * also means the one number the seller is accountable for is the one recorded.
 *
 * The consequence is that re-pricing has to happen *here* when the customer
 * changes tier, which `TillPage` does through `GET /products/:id/price` rather
 * than by doing the arithmetic itself.
 *
 * **The ids come from the cart, not from here.** Minting them per call would
 * mean two attempts at the same sale described two different sales, which is
 * precisely what client-supplied identity exists to prevent (§8).
 */
export function toSaleLines(lines: readonly CartLine[]) {
  return lines.map((line) => ({
    id: line.saleLineId,
    productId: line.productId,
    unitId: line.unitId,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
  }));
}
