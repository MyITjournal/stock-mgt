/**
 * The rules for putting a recorded sale right (2026-10-08), kept pure so they
 * can be tested without a database — the same split as `delivery-correction.ts`.
 *
 * Found in real use: a rep rang a sale up at the list price, the owner gave the
 * customer a discount, and the cash in hand was less than the app said had been
 * taken. Nothing could put it right. Now an owner or manager states **the
 * prices that were really charged** — per item, the way the till records a
 * negotiated price — or **the customer it really was**, or both.
 *
 * What follows from the prices:
 *
 * - **The lines and the sale take the true figures**, VAT split out again at
 *   each line's frozen rate. Every report reads those figures, so nothing
 *   downstream needs to know a correction happened.
 * - **A payment that would now be more than the sale is brought down with it.**
 *   The cash the app says was taken was never taken, so the payment is a
 *   mistake — and §11 corrects a mistake with a void. It is voided and one for
 *   the true amount recorded in its place: same person, method, store and day,
 *   so their cash in hand and Money in say what really came in.
 * - **Refused once goods have come back on the sale**: the refund was worked
 *   out from the old price, and the two would no longer agree.
 * - **A sale paid in full stays paid in full** (2026-10-09): a price can be
 *   raised as well as discounted, and a customer who paid at the till paid
 *   what they were charged. The payment goes up with the total, the same way
 *   it comes down. A sale that went out on credit, or part-paid, simply owes
 *   the difference — raising its payment would record money nobody took.
 *
 * What follows from the customer: payments that settled only this sale move
 * with it. One that also settled other invoices belongs to the old customer's
 * account as a whole, so moving the sale is refused until it is voided.
 *
 * **No correction leaves a walk-in sale owing**: there is nobody to collect it
 * from. Making a sale that still owes a walk-in's is refused; so is correcting
 * the prices of a walk-in sale that was never paid in full, unless the same
 * correction names who owes it.
 *
 * Stock and cost never move: the same goods went out.
 */
import { priceLine } from './sale-pricing';

export interface RecordedLine {
  id: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  taxRateBps: number;
  taxAmount: number;
}

/** A payment with an allocation on this sale. */
export interface PaymentOnSale {
  id: string;
  /** The whole payment, signed. */
  amount: number;
  /** How much of it is on this sale. */
  allocatedHere: number;
  /** True when some of it also settled other invoices. */
  allocatedElsewhere: boolean;
  voided: boolean;
  occurredAt: Date;
}

export interface RecordedSale {
  customerId: string | null;
  total: number;
  taxTotal: number;
  lines: readonly RecordedLine[];
  hasReturns: boolean;
  /** The credit raised by returns, as `saleBalance` counts it. */
  refunded: number;
  payments: readonly PaymentOnSale[];
}

export interface CorrectionRequest {
  /** Undefined: unchanged. Null: a walk-in. */
  customerId?: string | null;
  lines?: readonly { lineId: string; unitPrice: number }[];
}

export interface LinePriceChange {
  line: RecordedLine;
  unitPrice: number;
  lineTotal: number;
  taxAmount: number;
}

/** A payment brought to the new total, down or up: void this one, record `amount`. */
export interface PaymentFollows {
  paymentId: string;
  /** What the replacement records; zero means none is recorded. */
  amount: number;
}

export type SaleCorrectionPlan =
  | { refused: { status: 400 | 409; message: string } }
  | {
      refused?: undefined;
      customerChanged: boolean;
      customerIdAfter: string | null;
      lineChanges: LinePriceChange[];
      totalAfter: number;
      taxTotalAfter: number;
      paidBefore: number;
      paidAfter: number;
      follows: PaymentFollows | null;
      /** Payments to move to the new customer (live and voided alike). */
      movePaymentIds: string[];
    };

/**
 * Works out what a correction does, or why it cannot be done. `money` formats
 * an amount for a message in the shop's currency (`shopMoney`).
 */
export function planSaleCorrection(
  sale: RecordedSale,
  request: CorrectionRequest,
  money: (minor: number) => string,
): SaleCorrectionPlan {
  const refuse = (status: 400 | 409, message: string) => ({
    refused: { status, message },
  });

  // ── Prices ────────────────────────────────────────────────────────────
  const seen = new Set<string>();
  const lineChanges: LinePriceChange[] = [];
  for (const wanted of request.lines ?? []) {
    if (seen.has(wanted.lineId)) {
      return refuse(400, 'Each line can be corrected once per correction.');
    }
    seen.add(wanted.lineId);

    const line = sale.lines.find((row) => row.id === wanted.lineId);
    if (!line) return refuse(400, 'That line is not on this sale.');
    if (wanted.unitPrice === line.unitPrice) continue;

    const priced = priceLine(wanted.unitPrice, line.quantity, line.taxRateBps);
    lineChanges.push({
      line,
      unitPrice: priced.unitPrice,
      lineTotal: priced.lineTotal,
      taxAmount: priced.taxAmount,
    });
  }

  const customerIdAfter =
    request.customerId === undefined ? sale.customerId : request.customerId;
  const customerChanged = customerIdAfter !== sale.customerId;

  if (lineChanges.length === 0 && !customerChanged) {
    return refuse(400, 'Nothing has changed — the sale already says that.');
  }

  if (lineChanges.length > 0 && sale.hasReturns) {
    return refuse(
      409,
      'Goods have already come back on this sale, and the refund was worked out from the old prices. The prices can no longer be corrected; the customer can be.',
    );
  }

  const totalAfter =
    sale.total +
    lineChanges.reduce(
      (sum, row) => sum + row.lineTotal - row.line.lineTotal,
      0,
    );
  const taxTotalAfter =
    sale.taxTotal +
    lineChanges.reduce(
      (sum, row) => sum + row.taxAmount - row.line.taxAmount,
      0,
    );

  const live = sale.payments.filter((payment) => !payment.voided);
  const paidBefore = live.reduce((sum, row) => sum + row.allocatedHere, 0);
  // The most recent payment that went wholly to this sale and was money in.
  const latestOwn = (enough: (payment: PaymentOnSale) => boolean) =>
    live
      .filter(
        (payment) =>
          !payment.allocatedElsewhere && payment.amount > 0 && enough(payment),
      )
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0];

  // ── The payment follows a lower total ────────────────────────────────────
  let follows: PaymentFollows | null = null;
  const excess = paidBefore - totalAfter;
  if (excess > 0) {
    // Only a payment that went wholly to this sale, and is big enough to take
    // the whole excess; the most recent, when there are several.
    const candidate = latestOwn((payment) => payment.allocatedHere >= excess);
    if (!candidate) {
      return refuse(
        409,
        `${money(paidBefore)} has been paid against this sale, more than its corrected total of ${money(totalAfter)}, and no single payment can be brought down to cover it. Void the payment that was too much first, then correct the prices.`,
      );
    }
    follows = { paymentId: candidate.id, amount: candidate.amount - excess };
  }
  let paidAfter = paidBefore - Math.max(excess, 0);

  // ── The payment follows a higher total, on a sale paid in full ───────────
  // Raised by the difference, so it still tallies. With no payment of its own
  // to raise (one that also paid other invoices), the difference is owed.
  const owedBefore = sale.total - paidBefore - sale.refunded;
  const shortfall = totalAfter - paidAfter - sale.refunded;
  const raised =
    owedBefore <= 0 && paidBefore > 0 && shortfall > 0
      ? latestOwn(() => true)
      : undefined;
  if (raised) {
    follows = { paymentId: raised.id, amount: raised.amount + shortfall };
    paidAfter += shortfall;
  }

  // ── A walk-in cannot owe ─────────────────────────────────────────────────
  // Nobody to collect it from (owner, 2026-10-09).
  const owedAfter = totalAfter - paidAfter - sale.refunded;
  if (customerIdAfter === null && owedAfter > 0) {
    return refuse(
      409,
      customerChanged
        ? `${money(owedAfter)} is still owed on this sale, and a walk-in cannot buy on credit. Take the payment first, or keep the sale on a named customer.`
        : `A walk-in cannot buy on credit, and this sale would still owe ${money(owedAfter)}. Name the customer who owes it in the same correction.`,
    );
  }

  // ── The customer ─────────────────────────────────────────────────────────
  const movePaymentIds: string[] = [];
  if (customerChanged) {
    const shared = live.find((payment) => payment.allocatedElsewhere);
    if (shared) {
      return refuse(
        409,
        `A payment of ${money(shared.amount)} on this sale also paid other invoices of the same customer, so it cannot move with this one. Void that payment first, then change the customer and record it again.`,
      );
    }
    for (const payment of sale.payments) {
      if (!payment.allocatedElsewhere) movePaymentIds.push(payment.id);
    }
  }

  return {
    customerChanged,
    customerIdAfter,
    lineChanges,
    totalAfter,
    taxTotalAfter,
    paidBefore,
    paidAfter,
    follows,
    movePaymentIds,
  };
}
