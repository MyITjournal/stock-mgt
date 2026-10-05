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
 * balance = amountDue − paid − rebated
 * ```
 *
 * A sale nets off returns, because goods coming back reduce what the customer
 * owes. Here goods coming back are a credit note, recorded by correcting
 * `amountDue`. The term that did need its own history is the **vendor
 * rebate** (2026-10-05): a vendor pays it only as credit off a later bill, so
 * it lowers what that bill owes while being neither a payment — no money moved
 * — nor a change to the invoice, which still says what the goods cost.
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

/**
 * The query half for rebates: every rebate credited on the bill. A rebate is
 * linked to a bill only once it is credited, so the relation needs no filter —
 * but it must be **selected**, by every query that feeds a balance, or the bill
 * reads as owing money that was already credited away. Required in
 * `BillBalanceInput` so the compiler says where it was forgotten.
 */
export const CREDITED_REBATES = {
  select: { creditedAmount: true },
} as const;

export interface BillBalanceInput {
  amountDue: Minor;
  payments: readonly { amount: Minor }[];
  rebates: readonly { creditedAmount: Minor | null }[];
}

export interface BillBalance {
  /** Settled so far, excluding anything voided. */
  paid: Minor;
  /** Credited off this bill by vendor rebates. */
  rebated: Minor;
  /** Positive: the business still owes. Zero: settled. */
  balance: Minor;
}

export function billBalance(bill: BillBalanceInput): BillBalance {
  const paid = bill.payments.reduce((total, row) => total + row.amount, 0);
  const rebated = bill.rebates.reduce(
    (total, row) => total + (row.creditedAmount ?? 0),
    0,
  );
  return { paid, rebated, balance: bill.amountDue - paid - rebated };
}

/** Attaches the derived figures to a bill row for the API to return. */
export function withBillBalance<T extends BillBalanceInput>(bill: T) {
  return { ...bill, ...billBalance(bill) };
}
