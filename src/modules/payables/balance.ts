import { Minor } from '../../common/money/money';

/**
 * What a vendor bill still owes.
 *
 * The money-out mirror of `payments/balance.ts`, and deliberately its own file
 * for the same reason that one exists: "what is still owed" is a single
 * decision, and the moment two places compute it they start disagreeing. The
 * customer side learned this the hard way — §11 records the void filter being
 * forgotten in a fourth `include` — so the filter and the arithmetic live
 * together here from the start.
 *
 * ```
 * balance = amountDue − paid
 * ```
 *
 * Simpler than the customer side by one term. A sale nets off returns, because
 * goods coming back reduce what the customer owes. Nothing equivalent exists
 * here: when a vendor takes goods back they issue a credit note, which is a
 * change to what is owed and is recorded by correcting `amountDue`, not by a
 * second row. If vendor credit notes ever need their own history, this is the
 * function that grows a term.
 */

/**
 * The query half of the rule: payments that still count are the ones nobody
 * voided.
 *
 * Spread this into **any** `payments` selection that feeds a balance. It is the
 * one thing that is easy to get wrong here, exactly as `LIVE_ALLOCATIONS` is on
 * the customer side — a voided payment left in the sum makes a bill look
 * settled when the money never moved.
 */
export const LIVE_SUPPLIER_PAYMENTS = {
  where: { voidedAt: null },
  select: { amount: true },
} as const;

export interface BillBalanceInput {
  amountDue: Minor;
  payments: readonly { amount: Minor }[];
}

export interface BillBalance {
  /** Settled so far, excluding anything voided. */
  paid: Minor;
  /** Positive: the business still owes. Zero: settled. */
  balance: Minor;
}

export function billBalance(bill: BillBalanceInput): BillBalance {
  const paid = bill.payments.reduce((total, row) => total + row.amount, 0);
  return { paid, balance: bill.amountDue - paid };
}

/** Attaches the derived figures to a bill row for the API to return. */
export function withBillBalance<T extends BillBalanceInput>(bill: T) {
  return { ...bill, ...billBalance(bill) };
}
