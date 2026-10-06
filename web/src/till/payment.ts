import type { Minor } from '../lib/money';

/**
 * How the money is being taken, as data and rules rather than rendering.
 *
 * Separate from `PaymentPanel` for the same reason `cart.ts` is separate from
 * the table: these are the server's rules restated, and they are worth reading
 * without the markup around them.
 */

export type PaymentMethod = 'cash' | 'transfer' | 'pos' | 'cheque';

/**
 * Methods that settle into a named account.
 *
 * Mirrors the server: `transfer` and `pos` **must** say which account took the
 * money, `cash` **must not**, and neither is ever defaulted for someone who did
 * not choose — a wrong account only surfaces weeks later when a statement is
 * reconciled (DECISIONS.md §11). A cheque is written today and banked whenever,
 * so it is left optional rather than guessed at.
 */
const BANKED: readonly PaymentMethod[] = ['transfer', 'pos'];

export function needsBankAccount(method: PaymentMethod): boolean {
  return BANKED.includes(method);
}

export interface PaymentState {
  customerId: string | null;
  method: PaymentMethod;
  /** Null means "paying the whole thing", which is the counter default. */
  amount: Minor | null;
  bankAccountId: string | null;
  reference: string;
  /**
   * The customer takes the goods now and pays later — the whole sale goes on
   * credit and **no money is taken**, so there is no method, account or amount
   * to ask. Before this, the only way was to type 0 against "Cash" and press
   * "Take payment", which said the opposite of what happened.
   */
  payLater: boolean;
}

export const EMPTY_PAYMENT: PaymentState = {
  customerId: null,
  method: 'cash',
  amount: null,
  bankAccountId: null,
  reference: '',
  payLater: false,
};

/** What is paid now: nothing on credit, else what was typed, else the total. */
export function payingNow(state: PaymentState, total: Minor): Minor {
  if (state.payLater) return 0;
  return state.amount ?? total;
}
