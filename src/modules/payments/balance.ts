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
