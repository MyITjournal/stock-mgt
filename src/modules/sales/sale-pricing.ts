/**
 * The arithmetic of an invoice line, kept pure so it can be tested exhaustively
 * without a database — the same reasoning as `money.ts` and `fefo.ts`.
 *
 * Two rules from DECISIONS.md §2 are enforced here rather than trusted to the
 * caller:
 *
 * - **Tax is derived by subtraction.** `splitTaxInclusive` guarantees
 *   `net + tax === gross` at every rounding boundary, so a line's tax can never
 *   drift from its total.
 * - **Cost of goods sold is rounded exactly once.** The batches a pick spans
 *   each contribute an exact fraction; rounding per batch and summing would let
 *   the error compound with every extra lot a sale touches.
 */
import { BadRequestException } from '@nestjs/common';
import { Minor, multiply, splitTaxInclusive } from '../../common/money/money';
import { MAX_MINOR_UNITS } from '../../common/money/is-money.validator';

export interface PricedLine {
  /** Tax-inclusive price of one selling unit, in kobo. */
  unitPrice: Minor;
  /** `unitPrice * quantity`. */
  lineTotal: Minor;
  taxRateBps: number;
  /** The VAT inside `lineTotal`. */
  taxAmount: Minor;
}

/**
 * Prices one line: `unitPrice × quantity`, with the VAT it already contains
 * split out and frozen.
 *
 * Quantity is counted in the selling unit — two cartons, not forty-eight
 * pieces — because `unitPrice` is the price of one of those units. Base units
 * are the ledger's concern, not the invoice's.
 */
export function priceLine(
  unitPrice: Minor,
  quantity: number,
  taxRateBps: number,
): PricedLine {
  const lineTotal = multiply(unitPrice, quantity);

  // Both inputs are individually bounded by their validators, and their product
  // still is not: a price and a quantity that are each acceptable can multiply
  // past what an `int4` column holds. Caught here, where the multiplication
  // happens, so the caller gets a 400 naming the line instead of a 500 carrying
  // a Postgres range error up from the driver.
  if (lineTotal > MAX_MINOR_UNITS) {
    throw new BadRequestException(
      `A line of ${quantity} at ${unitPrice} comes to ${lineTotal}, which is more than this system can record on one line (${MAX_MINOR_UNITS}). Split it across several lines.`,
    );
  }

  const { tax } = splitTaxInclusive(lineTotal, taxRateBps);

  return { unitPrice, lineTotal, taxRateBps, taxAmount: tax };
}

/**
 * Rounds an exact cost to whole kobo. The single rounding point for cost of
 * goods sold: `StockService.costOf` returns a fraction spanning however many
 * batches FEFO picked, and this is where it stops being one.
 */
export function roundCost(exact: number): Minor {
  if (!Number.isFinite(exact)) {
    throw new RangeError(`Cost must be a finite number, got ${exact}`);
  }
  return Math.round(exact);
}

/**
 * The share of a line that `quantity` base units represents.
 *
 * Used when goods come back: returning 2 of the 5 cartons on a line refunds two
 * fifths of what was charged and reverses two fifths of what it cost. Rounded
 * once, here.
 *
 * Deliberately proportional to `baseQuantity` rather than recomputed from
 * `unitPrice`: a line may have been sold at a negotiated price, and the
 * customer is owed a share of what they actually paid.
 */
export function proportionOfLine(
  amount: Minor,
  baseQuantity: number,
  returnedBaseQuantity: number,
): Minor {
  if (!Number.isInteger(returnedBaseQuantity) || returnedBaseQuantity <= 0) {
    throw new RangeError(
      `Returned quantity must be a positive integer, got ${returnedBaseQuantity}`,
    );
  }
  if (returnedBaseQuantity > baseQuantity) {
    throw new RangeError(
      `Cannot return ${returnedBaseQuantity} of a line that sold ${baseQuantity}`,
    );
  }

  // The whole line returns the whole amount, with no rounding to lose a kobo on.
  if (returnedBaseQuantity === baseQuantity) return amount;

  return Math.round((amount * returnedBaseQuantity) / baseQuantity);
}
