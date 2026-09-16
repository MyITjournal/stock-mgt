/**
 * Vendor purchase targets: how much of a monthly quota has actually arrived.
 *
 * Pure, like `period.ts` and `profit.ts`, because the one rule here that is
 * easy to get wrong is a subtraction rather than a query, and a subtraction is
 * worth testing without a database in the way.
 */

/** A target as stored, reduced to what the arithmetic needs. */
export interface TargetRow {
  id: string;
  /** Exactly one of these is set. */
  categoryId: string | null;
  productId: string | null;
  /** In base units. */
  targetQuantity: number;
  /** In kobo, or null for a quota written only in cases. */
  targetValue: number | null;
}

/** One received line inside the target month, from the right vendor. */
export interface ReceiptLine {
  productId: string;
  /** The product's category at the time of reading, or null. */
  categoryId: string | null;
  /**
   * Base units the vendor was **paid** for. Free goods are real stock and
   * count for valuation, but they do not advance a quota — confirmed with the
   * owner on 2026-08-29: "buy 19, get 1 free" moves a 110-case target by 19.
   */
  quantityPaidFor: number;
  /** Exact invoice total for the line, in kobo. */
  totalCost: number;
}

export interface TargetProgress {
  targetId: string;
  targetQuantity: number;
  achievedQuantity: number;
  remainingQuantity: number;
  targetValue: number | null;
  achievedValue: number;
  remainingValue: number | null;
  /** Basis points of the quantity target, so 10000 is exactly met. */
  achievedBps: number;
}

/**
 * Which lines count toward each target, and how much of each quota is left.
 *
 * **The rule that makes this non-obvious**: a category target covers only the
 * products in that category that do *not* carry a target of their own. A vendor
 * who quotas both "lotions" and one specific lotion SKU would otherwise see
 * that SKU's cartons advance both rows, and the vendor's own sheet would
 * disagree with ours. So the product targets are resolved first and the
 * category target is given what is left over.
 *
 * Children of a category are **not** included: the named category only. The
 * owner's targets are leaf categories ("lotions", "roll-on"), and rolling up a
 * tree would mean excluding a product target from every ancestor above it,
 * which is a second subtraction nobody has asked for yet.
 */
export function rollUpTargets(
  targets: TargetRow[],
  lines: ReceiptLine[],
): TargetProgress[] {
  const targetedProducts = new Set(
    targets
      .map((target) => target.productId)
      .filter((id): id is string => !!id),
  );

  return targets.map((target) => {
    const counted = lines.filter((line) =>
      target.productId
        ? line.productId === target.productId
        : line.categoryId === target.categoryId &&
          // The subtraction: a product with its own target is already counted
          // there, so it must not also land in its category's total.
          !targetedProducts.has(line.productId),
    );

    const achievedQuantity = counted.reduce(
      (sum, line) => sum + line.quantityPaidFor,
      0,
    );
    const achievedValue = counted.reduce(
      (sum, line) => sum + line.totalCost,
      0,
    );

    return {
      targetId: target.id,
      targetQuantity: target.targetQuantity,
      achievedQuantity,
      // Never negative: over-delivering leaves nothing to chase, and a negative
      // "remaining" reads as a credit on a screen that is about shortfalls.
      remainingQuantity: Math.max(0, target.targetQuantity - achievedQuantity),
      targetValue: target.targetValue,
      achievedValue,
      remainingValue:
        target.targetValue === null
          ? null
          : Math.max(0, target.targetValue - achievedValue),
      achievedBps: achievedShare(achievedQuantity, target.targetQuantity),
    };
  });
}

/**
 * Progress as basis points of the target.
 *
 * A target of zero is meaningless rather than infinite, so it reads as met:
 * nothing was asked for and nothing is outstanding.
 */
function achievedShare(achieved: number, target: number): number {
  if (target <= 0) return 10000;
  return Math.round((achieved / target) * 10000);
}
