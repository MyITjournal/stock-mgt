import { MAX_MINOR_UNITS } from '../../common/money/is-money.validator';
import { optionLabel } from '../catalog/variants';

/**
 * Opening stock: what is on the shelves on the day a shop starts using Reho,
 * and what it cost. The rules, with no database.
 *
 * ## Why it is not a delivery
 *
 * A delivery raises a bill (§16) and counts toward this month's vendor targets
 * and the purchases report. Goods bought and paid for months ago are none of
 * those, and recording them as a delivery put a debt on *Bills* (then called *We owe*) that had been
 * settled since June. So opening stock is an **opening-balance adjustment**:
 * a lot with the cost the owner gives and nothing paid for through Reho
 * (`quantityPaidFor: 0`), which stock valuation and cost of goods sold read
 * like any other lot, and which no bill, target or purchases report sees.
 *
 * ## Only where nothing has come in yet
 *
 * A product is offered only at a location where stock has never come in. That
 * is what makes entering it twice impossible rather than merely unlikely; a
 * product that already has stock is corrected with a count. A product sold
 * before it was counted has only outbound movements, so it is still offered —
 * which is exactly the shop that needs this most.
 *
 * ## Per option (2026-10-08)
 *
 * A product with options is entered **per option** — Chicken and Pepper Soup
 * are different stock — and "has stock come in here" is asked per option too,
 * so Pepper Soup is still offered after Chicken is entered. Each option's
 * opening stock is a lot of its own, which is what lets one option's cost be
 * corrected without touching another's.
 */

/**
 * The key "already stocked here" is asked by: the product, or the product
 * and its option.
 */
export function stockKey(productId: string, variantId?: string | null): string {
  return variantId ? `${productId}/${variantId}` : productId;
}

export interface OpeningProduct {
  id: string;
  name: string;
  units: readonly { id: string; name: string; factor: number }[];
  /** Its options; none for a product without. */
  variants?: readonly { id: string; name: string; isActive: boolean }[];
}

export interface OpeningLineInput {
  productId: string;
  /** Which option, for a product with options — required then. */
  variantId?: string | null;
  unitId: string;
  /** In `unitId`; may be a decimal that comes to whole base units. */
  quantity: number;
  unitCost: number;
  expiryDate?: string;
}

export interface PlannedOpeningLine {
  productId: string;
  variantId: string | null;
  /** In base units. */
  quantity: number;
  /**
   * The unit cost times the quantity, **rounded once**, here: exact whenever
   * the quantity is whole, and within half a kobo of the true total when it is
   * a decimal like 6.25 — the lot keeps this total and nothing is rounded again
   * (§2).
   */
  totalCost: number;
  expiryDate?: Date;
}

export interface OpeningPlan {
  lines: PlannedOpeningLine[];
  /** Names of products (and options) that already have stock at this location. */
  alreadyStocked: string[];
  /** Anything else wrong, in words. */
  problems: string[];
}

export function planOpeningStock(
  inputs: readonly OpeningLineInput[],
  products: ReadonlyMap<string, OpeningProduct>,
  stockedHere: ReadonlySet<string>,
): OpeningPlan {
  const lines: PlannedOpeningLine[] = [];
  const alreadyStocked = new Set<string>();
  const problems: string[] = [];

  for (const input of inputs) {
    const product = products.get(input.productId);
    if (!product) {
      problems.push(
        'One of the products is not in your catalog, or does not keep stock.',
      );
      continue;
    }
    const variants = product.variants ?? [];
    const variantId = input.variantId ?? null;
    const variant = variants.find((row) => row.id === variantId);
    if (variants.length > 0 && !variantId) {
      problems.push(`${product.name} comes in options. Say which one.`);
      continue;
    }
    if (variantId && !variant) {
      problems.push(`${product.name}: that option is not one of its options.`);
      continue;
    }
    if (variant && !variant.isActive) {
      problems.push(
        `${optionLabel(product.name, variant.name)} is retired, so it cannot take stock.`,
      );
      continue;
    }
    const label = optionLabel(product.name, variant?.name);
    if (stockedHere.has(stockKey(product.id, variantId))) {
      alreadyStocked.add(label);
      continue;
    }
    const unit = product.units.find((row) => row.id === input.unitId);
    if (!unit) {
      problems.push(`${label}: that unit is not one of its units.`);
      continue;
    }

    // A decimal in the chosen unit must land on whole counted-in units:
    // 6.25 cartons of 12 is 75 pieces, 6.1 is not a number of pieces at all.
    const exactBase = input.quantity * unit.factor;
    const baseQuantity = Math.round(exactBase);
    if (baseQuantity < 1 || Math.abs(exactBase - baseQuantity) > 1e-6) {
      problems.push(
        `${label}: ${input.quantity} ${unit.name} is not a whole number of the units it is counted in. Use a smaller unit, or a quantity that divides evenly.`,
      );
      continue;
    }

    const totalCost = Math.round(input.unitCost * input.quantity);
    if (!Number.isSafeInteger(totalCost) || totalCost > MAX_MINOR_UNITS) {
      problems.push(`${label}: that cost is too large to record.`);
      continue;
    }

    lines.push({
      productId: product.id,
      variantId,
      quantity: baseQuantity,
      totalCost,
      ...(input.expiryDate && { expiryDate: new Date(input.expiryDate) }),
    });
  }

  return {
    lines,
    alreadyStocked: [...alreadyStocked],
    problems: [...new Set(problems)],
  };
}

/**
 * What a product's cost-price display should read after its opening stock:
 * the total over the base units, rounded once. A convenience for pricing
 * screens, exactly as a delivery writes it — never a valuation input (§2).
 */
export function costPriceAfterOpening(
  lines: readonly PlannedOpeningLine[],
): Map<string, number> {
  const totals = new Map<string, { cost: number; quantity: number }>();
  for (const line of lines) {
    const running = totals.get(line.productId) ?? { cost: 0, quantity: 0 };
    running.cost += line.totalCost;
    running.quantity += line.quantity;
    totals.set(line.productId, running);
  }
  return new Map(
    [...totals].map(([productId, { cost, quantity }]) => [
      productId,
      Math.round(cost / quantity),
    ]),
  );
}

/**
 * What an opening lot is worth once its cost is put right (2026-10-07): the
 * cost of one of the chosen unit, times how many of that unit the lot held —
 * `unitCost × quantityReceived ÷ factor` — **rounded once**, here, like any
 * lot total (§2). 3 pieces at ₦12,433.36 per 1/2 pack of 3 is ₦12,433.36.
 */
export function correctedOpeningTotal(input: {
  quantityReceived: number;
  unitFactor: number;
  unitCost: number;
}): number {
  return Math.round(
    (input.unitCost * input.quantityReceived) / input.unitFactor,
  );
}
