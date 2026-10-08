import { addDays, startOfDay } from '../reports/period';

/**
 * Is this sale already recorded (2026-10-08)?
 *
 * The owner recorded a customer's sale because a member of staff had not, and
 * nothing would have told him before he entered it again. An `Idempotency-Key`
 * stops one device sending one sale twice; it cannot know that two people are
 * recording the same thing that happened. This is that check — a **warning,
 * never a refusal**: a customer can genuinely buy the same thing twice in a
 * day, so whoever is at the till decides, and "Record anyway" goes through.
 *
 * Pure, so the rule is tested without a database.
 */

/** A walk-in is nobody in particular, so only a sale this close counts. */
export const WALK_IN_WINDOW_MS = 10 * 60 * 1000;

export interface DuplicateWindow {
  from: Date;
  /** Exclusive. */
  to: Date;
}

/**
 * Where to look: **the same day in the shop's timezone** for a named customer
 * — the day the sale is dated, so a sale entered from yesterday's notebook is
 * checked against yesterday — and **ten minutes either side** for a walk-in,
 * since a whole day of walk-ins buying one Peak Milk is a normal day.
 */
export function duplicateWindow(
  customerId: string | null | undefined,
  occurredAt: Date,
  timezone: string,
): DuplicateWindow {
  if (customerId) {
    return {
      from: startOfDay(timezone, occurredAt),
      to: addDays(timezone, occurredAt, 1),
    };
  }
  return {
    from: new Date(occurredAt.getTime() - WALK_IN_WINDOW_MS),
    to: new Date(occurredAt.getTime() + WALK_IN_WINDOW_MS + 1),
  };
}

export interface ItemLine {
  productId: string;
  /** Eva soap Gold and Eva soap Classic are different goods. */
  variantId?: string | null;
  /** Absent on a request that let the server pick the selling unit. */
  unitId?: string | null;
  quantity: number;
}

/**
 * The same goods in the same amounts, whatever order the lines are in.
 *
 * **Prices are not compared**: the second person may have typed a different
 * price for the same goods, and that is still the same sale. Two lines of one
 * product add together, as they would on a shelf. If the request leaves a unit
 * for the server to choose, units are ignored on both sides rather than
 * guessed — "3 of Peak Milk" matches whichever unit was recorded.
 */
export function sameItems(
  requested: readonly ItemLine[],
  recorded: readonly ItemLine[],
): boolean {
  const withUnits = requested.every((line) => line.unitId);
  const tally = (lines: readonly ItemLine[]) => {
    const totals = new Map<string, number>();
    for (const line of lines) {
      const item = `${line.productId}|${line.variantId ?? ''}`;
      const key = withUnits ? `${item}|${line.unitId}` : item;
      totals.set(key, (totals.get(key) ?? 0) + line.quantity);
    }
    return totals;
  };

  const a = tally(requested);
  const b = tally(recorded);
  if (a.size !== b.size) return false;
  for (const [key, quantity] of a) if (b.get(key) !== quantity) return false;
  return true;
}
