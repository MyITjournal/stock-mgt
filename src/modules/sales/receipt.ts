import type { PaymentMethod } from '@prisma/client';

/** One way the money came in, and how much came in that way. */
export interface PaidBy {
  method: PaymentMethod;
  amount: number;
}

/** What a receipt reads off each payment put against the sale. */
export interface ReceiptAllocation {
  amount: number;
  payment: {
    method: PaymentMethod;
    occurredAt: Date;
    voidedAt?: Date | null;
  };
}

/**
 * How a sale was paid, a line per method (owner, 2026-10-09: "let a receipt
 * indicate the mode of payment").
 *
 * Summed per method rather than listed per payment: the customer wants to see
 * "cash ₦5,000, transfer ₦3,000", not three dated rows. Signed, so cash handed
 * back on a return comes off the cash it was paid in, and a method that nets
 * to nothing is left off. A voided payment never settled anything and is
 * skipped even if a caller forgets to filter it. In the order the money came
 * in, so the first line is how the customer paid at the counter.
 */
export function paidByMethod(
  allocations: readonly ReceiptAllocation[],
): PaidBy[] {
  const live = allocations
    .filter((row) => !row.payment.voidedAt)
    .sort(
      (a, b) => a.payment.occurredAt.getTime() - b.payment.occurredAt.getTime(),
    );

  const byMethod = new Map<PaymentMethod, number>();
  for (const row of live) {
    byMethod.set(
      row.payment.method,
      (byMethod.get(row.payment.method) ?? 0) + row.amount,
    );
  }

  return [...byMethod]
    .filter(([, amount]) => amount !== 0)
    .map(([method, amount]) => ({ method, amount }));
}
