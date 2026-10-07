import { BadRequestException } from '@nestjs/common';
import { BusinessType } from '@prisma/client';

/**
 * Which of a product's units the till may sell, and which it picks first.
 *
 * ## Counting is not selling
 *
 * The base unit (factor 1) is what stock is *counted* in: the smallest piece
 * that can be left on a shelf. That is not the same as the smallest thing the
 * shop sells. A distributor counts Peak 14g in sachets — half a carton leaves
 * half a roll behind — and never sells a sachet. Hence `isSellable`, separate
 * from `isBase`: a unit can be counted in without being offered at the till.
 *
 * Pure, so the rules are tested without a database and both create and update
 * reach the same answer.
 */

export interface UnitShape {
  name: string;
  factor: number;
}

/**
 * Whether a unit starts out sold at the till, when the caller did not say.
 *
 * A wholesaler's base unit starts unsold — that is the whole point of asking
 * the kind of shop at sign-up (§22). Every other unit starts sold. And a
 * product with a single unit always sells it, whatever the shop: a delivery
 * charge counted in `trip` has nothing else to sell.
 */
export function defaultIsSellable(
  unit: UnitShape,
  unitCount: number,
  businessType: BusinessType,
): boolean {
  if (unitCount <= 1) return true;
  if (unit.factor !== 1) return true;
  return businessType !== BusinessType.wholesale;
}

export interface SettledUnit extends UnitShape {
  id: string;
  isSellable: boolean;
  isDefaultSelling: boolean;
}

/**
 * The one unit the till picks first. Throws when nothing can be sold.
 *
 * In order: the unit the caller just asked for, if it is sold; else the
 * current default, if it is still sold; else a fresh choice — the largest unit
 * for a wholesaler, who sells by the carton, and the smallest for anyone else.
 *
 * Asking for an unsold unit as the default is refused rather than quietly
 * overridden: the form offers only sold units, so a request like that is a
 * mistake somebody should hear about.
 */
export function chooseDefaultSellingUnit(
  units: readonly SettledUnit[],
  requestedName: string | undefined,
  businessType: BusinessType,
): string {
  const sellable = units.filter((unit) => unit.isSellable);
  if (sellable.length === 0) {
    throw new BadRequestException(
      'At least one unit has to be sold at the till, or this product cannot be sold at all. Tick "Sold at the till" on one of them.',
    );
  }

  if (requestedName !== undefined) {
    const requested = units.find((unit) => unit.name === requestedName);
    if (requested && !requested.isSellable) {
      throw new BadRequestException(
        `"${requested.name}" is not sold at the till, so it cannot be what the till picks first.`,
      );
    }
    if (requested) return requested.id;
  }

  const current = sellable.find((unit) => unit.isDefaultSelling);
  if (current) return current.id;

  const byFactor = [...sellable].sort((a, b) => a.factor - b.factor);
  const chosen =
    businessType === BusinessType.wholesale ? byFactor.at(-1) : byFactor[0];
  return (chosen as SettledUnit).id;
}

/**
 * The unit the till picks first when an item is added: the default selling
 * unit, or else the smallest one the till may sell. Null when it sells none.
 *
 * One rule, read by the till's search and by every product read, so the price
 * and cost a products list shows are always for the unit a cashier is handed
 * (2026-10-07). `units` in any order.
 */
export function tillFirstUnit<
  U extends { isSellable: boolean; isDefaultSelling: boolean; factor: number },
>(units: readonly U[]): U | null {
  const sellable = units
    .filter((unit) => unit.isSellable)
    .sort((a, b) => a.factor - b.factor);
  return sellable.find((unit) => unit.isDefaultSelling) ?? sellable[0] ?? null;
}
