import { Minor } from '../../common/money/money';

/**
 * What an invoice still owes.
 *
 * Three numbers meet here, and the reason this is one function rather than
 * three call sites is that they must never disagree:
 *
 * ```
 * balance = total − allocated − refunded
 * ```
 *
 * - `allocated` is the sum of payment allocations against the sale. Signed, so
 *   cash handed back reduces it again.
 * - `refunded` is the credit raised by returns — the goods came back, so that
 *   much of the invoice is no longer owed.
 *
 * It composes without special cases. A ₦12,000 invoice paid in full sits at
 * zero. Return half of it and the balance goes to −₦6,000: the shop owes the
 * customer. Hand back the cash as a **negative** payment allocated to the same
 * sale and it returns to zero. No branch on "is this a refund".
 */
/**
 * The query half of the same rule: allocations that still count are the ones
 * belonging to a payment nobody voided.
 *
 * It lives here, beside the arithmetic, because "what counts toward a balance"
 * is one decision and splitting it across four `include` blocks is how the
 * fourth one gets forgotten. Spread it into any `allocations` selection that
 * feeds `saleBalance`.
 */
export const LIVE_ALLOCATIONS = {
  where: { payment: { voidedAt: null } },
  select: { amount: true },
} as const;

export interface SaleBalanceInput {
  total: Minor;
  allocations: readonly { amount: Minor }[];
  returns: readonly { refundAmount: Minor }[];
}

export interface SaleBalance {
  /** Settled by payments, signed. */
  allocated: Minor;
  /** Credited back by returns. */
  refunded: Minor;
  /** Positive: the customer owes. Negative: the business owes. */
  balance: Minor;
}

export function saleBalance(sale: SaleBalanceInput): SaleBalance {
  const allocated = sum(sale.allocations.map((row) => row.amount));
  const refunded = sum(sale.returns.map((row) => row.refundAmount));

  return { allocated, refunded, balance: sale.total - allocated - refunded };
}

/** Attaches the derived figures to a sale row for the API to return. */
export function withBalance<T extends SaleBalanceInput>(sale: T) {
  return { ...sale, ...saleBalance(sale) };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * How a balance that has gone *negative* is counted.
 *
 * A sale can end up owing money **back**: it was paid in full and then goods
 * were returned, or it was paid twice. That is a real debt, but it is the
 * business's debt rather than the customer's, and the two must not be summed
 * — netting them reports a smaller number than either one and hides both.
 *
 * Defined here, beside `saleBalance`, because the two halves of the rule kept
 * drifting apart while they lived in separate functions: `totalOutstanding`
 * filtered credits out while `groupByCustomer` netted them away, so a
 * receivables screen showed a headline ₦21,000 larger than its own breakdown
 * added up to. Anything that totals balances should split them through here.
 */
export interface OwedBothWays {
  /** Owed **to** the business. */
  owed: number;
  /** Owed **back**, as a positive number. */
  credit: number;
}

export function splitOwed(balances: readonly number[]): OwedBothWays {
  let owed = 0;
  let credit = 0;

  for (const balance of balances) {
    if (balance > 0) owed += balance;
    else credit -= balance;
  }

  return { owed, credit };
}
