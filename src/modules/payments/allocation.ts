import { Minor } from '../../common/money/money';

/**
 * Splitting a payment across the invoices it settles, kept pure so the rules
 * can be tested exhaustively without a database — the same reasoning as
 * `money.ts`, `fefo.ts` and `sale-pricing.ts`.
 *
 * The shape of the problem: one payment is what actually happened, and the
 * allocations are a claim about *which debts it answered*. Those are two
 * different things, and the arithmetic tying them together is where a
 * receivables figure goes quietly wrong.
 */

/** An invoice with money still outstanding on it. */
export interface Outstanding {
  saleId: string;
  /** What is still owed. Negative when the customer is owed money instead. */
  balance: Minor;
  /** INV-0012 — what a refusal calls it. Without it, "That invoice". */
  number?: string;
}

export interface AllocationRequest {
  saleId: string;
  amount: Minor;
}

export interface AllocationResult {
  allocations: AllocationRequest[];
  /** Money not claimed against any invoice: credit sitting on the customer. */
  unallocated: Minor;
}

/**
 * Checks a caller-supplied split and reports what is left over.
 *
 * Deliberately *not* clever: it does not spread a payment across invoices on
 * the caller's behalf. Which invoice a payment was meant for is exactly what
 * customers dispute, so the answer is recorded, not inferred. `allocateOldest`
 * exists for the caller that genuinely has no preference, and even then it is
 * opt-in.
 *
 * Signs must agree with the payment. A refund (negative payment) can only
 * unwind allocations, and money in can only settle debt.
 *
 * A refusal is read by the person at the payment form, so it names the
 * invoice by its number and amounts through `money` (`shopMoney`) — never a
 * sale id or a count of kobo.
 */
export function planAllocations(
  paymentAmount: Minor,
  requested: readonly AllocationRequest[],
  outstanding: readonly Outstanding[],
  money: (minor: Minor) => string = String,
): AllocationResult {
  assertMinor(paymentAmount, 'Payment amount');
  if (paymentAmount === 0) {
    throw new RangeError('A payment of zero records nothing');
  }

  const byId = new Map(outstanding.map((row) => [row.saleId, row]));
  const seen = new Set<string>();
  let claimed = 0;

  for (const request of requested) {
    assertMinor(request.amount, 'Allocation amount');
    const invoice = byId.get(request.saleId);
    const name = invoice?.number ?? 'That invoice';
    if (request.amount === 0) {
      throw new RangeError(
        `Nothing is put against ${name}, which settles nothing. Leave it off.`,
      );
    }
    if (Math.sign(request.amount) !== Math.sign(paymentAmount)) {
      throw new RangeError(
        `The amount against ${name} runs the opposite way to the payment. Money in settles debt; money out unwinds it.`,
      );
    }
    if (seen.has(request.saleId)) {
      throw new RangeError(
        `${name} appears twice in one payment. Combine them into a single line.`,
      );
    }
    seen.add(request.saleId);

    if (!invoice) {
      throw new RangeError(
        "That invoice is not on this payment's account, or nothing is owed on it.",
      );
    }

    // Over-allocating is refused rather than absorbed: paying ₦6,000 against a
    // ₦5,000 invoice is a typo far more often than it is generosity, and the
    // extra belongs on the customer as credit, where the next invoice finds it.
    if (
      Math.abs(request.amount) > Math.abs(invoice.balance) ||
      Math.sign(invoice.balance) !== Math.sign(request.amount)
    ) {
      throw new RangeError(
        `${name} owes ${money(invoice.balance)}, so ${money(request.amount)} cannot go against it. Put at most ${money(invoice.balance)} there — anything more stays as credit on the customer.`,
      );
    }

    claimed += request.amount;
  }

  if (Math.abs(claimed) > Math.abs(paymentAmount)) {
    throw new RangeError(
      `${money(claimed)} is put against invoices, which is more than the payment of ${money(paymentAmount)}. Each invoice gets a part of what was received, not its own total.`,
    );
  }

  return {
    allocations: [...requested],
    unallocated: paymentAmount - claimed,
  };
}

/**
 * Settles the oldest invoices first, for the caller that did not say.
 *
 * Only ever used when no allocations were supplied at all. A partial list is
 * taken at face value and the remainder becomes credit, because a caller who
 * named two invoices out of three meant the third to be left alone.
 */
export function allocateOldest(
  paymentAmount: Minor,
  outstanding: readonly Outstanding[],
): AllocationRequest[] {
  const allocations: AllocationRequest[] = [];
  let remaining = paymentAmount;

  for (const invoice of outstanding) {
    if (remaining === 0) break;
    if (Math.sign(invoice.balance) !== Math.sign(remaining)) continue;

    const take =
      Math.sign(remaining) *
      Math.min(Math.abs(invoice.balance), Math.abs(remaining));

    allocations.push({ saleId: invoice.saleId, amount: take });
    remaining -= take;
  }

  return allocations;
}

function assertMinor(value: number, what: string) {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(
      `${what} must be a whole number of kobo, got ${value}`,
    );
  }
}
