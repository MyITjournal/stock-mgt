import { Minor } from '../../common/money/money';

/**
 * Where each person's cash is, as one subtraction (2026-10-08).
 *
 * ```
 * still holding = received in cash − paid out in cash − banked − waiting
 * ```
 *
 * - **received**: cash payments they took, voided ones left out.
 * - **paid out**: cash refunds, cash expenses and cash supplier payments they
 *   recorded, and delivery fees paid from their cash — money that left the
 *   till in their hands.
 * - **banked**: banking an owner or manager has confirmed.
 * - **waiting**: banking recorded but not yet confirmed. Out of their hands,
 *   not yet known to be in the bank, so it has its own column rather than
 *   hiding inside either neighbour.
 *
 * A shortfall is never written off: banking less than you hold leaves the
 * rest here. Kept pure, like `balance.ts`, so the arithmetic is tested
 * without a database.
 */
export interface CashFigures {
  received: Minor;
  paidOut: Minor;
  banked: Minor;
  waiting: Minor;
}

export function stillHolding(figures: CashFigures): Minor {
  return figures.received - figures.paidOut - figures.banked - figures.waiting;
}

/**
 * The oldest cash this person has not banked yet, first in first out.
 *
 * Whatever left their hands is taken to have been the oldest money, so what is
 * still held is the newest takings. Walking newest-first until those cover the
 * amount held lands on the oldest one still in hand — and means a caller only
 * ever reads as far back as the amount held reaches, not the whole history.
 *
 * Null when nothing is held. If the receipts run out first (they cannot, while
 * paid out and banked are never negative) the oldest receipt read is the
 * answer rather than a guess.
 */
export function oldestUnbanked(
  held: Minor,
  receiptsNewestFirst: readonly { amount: Minor; occurredAt: Date }[],
): Date | null {
  if (held <= 0) return null;

  let covered = 0;
  for (const receipt of receiptsNewestFirst) {
    covered += receipt.amount;
    if (covered >= held) return receipt.occurredAt;
  }
  return receiptsNewestFirst.at(-1)?.occurredAt ?? null;
}

/**
 * What the shop has not banked, across everybody.
 *
 * Only what people hold is added up. Somebody who paid out more cash than they
 * took — from money brought from home, or taken before counting started —
 * shows a negative of their own, but it never cancels a colleague's holding,
 * the same reason receivables never net one customer's credit against
 * another's debt.
 */
export function notBanked(holdings: readonly Minor[]): Minor {
  return holdings.reduce((sum, held) => sum + Math.max(held, 0), 0);
}
