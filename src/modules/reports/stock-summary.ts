/**
 * Stock in and out over a period, per product (2026-10-07):
 *
 *     opening + delivered − sold ± adjusted = total
 *
 * The owner looked at "Decisions somebody made" expecting deliveries in it —
 * that list is only the changes made by hand — and asked for the whole story
 * per item. Every movement in the window lands in **exactly one** column, so
 * the line always adds up; the total is never worked out separately and hoped
 * to agree.
 *
 * Which column a movement belongs in:
 *
 * - **Opening** — everything before the period, **plus opening stock entered
 *   during it**: a shop that started on the 7th has its day-one stock there,
 *   not buried in "adjusted".
 * - **Delivered** — receipts, and corrections to them, so a delivery put right
 *   reads as what really arrived.
 * - **Sold** — sales less customer returns put back on the shelf, as a
 *   positive number of goods gone.
 * - **Adjusted** — everything else, signed: write-offs, counts, transfers,
 *   goods sent back to a vendor.
 *
 * ## And in money (2026-10-07)
 *
 * The owner needed the value of opening stock to check the books while there
 * are few records: **opening value + purchases − cost of what sold ±
 * adjustments = stock value**. Each movement is valued at **its own lot's exact
 * cost** — quantity × totalCost ÷ quantityReceived, the ratio stock valuation
 * uses (§2) — and the fractions are summed and **rounded once** per figure, so
 * the total is the stock value, not an approximation of it.
 *
 * "Sold" here is valued at the lot's cost **today**. The profit report uses
 * the cost frozen onto each sale, so after a delivery or opening cost is
 * corrected the two can differ — that difference is the correction, which is
 * what this report exists to show.
 */
import type { StockAdjustmentReason, StockMovementType } from '@prisma/client';

export type SummaryColumn = 'opening' | 'delivered' | 'sold' | 'adjusted';

/** The column one kind of movement belongs in — see the note above. */
export function columnFor(
  type: StockMovementType,
  reason: StockAdjustmentReason | null,
): SummaryColumn {
  if (reason === 'opening_balance') return 'opening';
  if (type === 'receipt' || reason === 'receipt_correction') return 'delivered';
  if (type === 'sale' || type === 'return_in') return 'sold';
  return 'adjusted';
}

/** Signed base units and, when known, their exact (unrounded) value. */
export interface Amount {
  quantity: number;
  value?: number;
}

export interface MovementTotal extends Amount {
  productId: string;
  type: StockMovementType;
  reason: StockAdjustmentReason | null;
}

/** One figure per column; `sold` is goods gone, positive. */
export interface SummaryFigures {
  opening: number;
  delivered: number;
  sold: number;
  adjusted: number;
  closing: number;
}

export interface SummaryLine extends SummaryFigures {
  productId: string;
  /** In minor units, each rounded once. Absent when no value was given. */
  value?: SummaryFigures;
}

export interface StockSummary {
  lines: SummaryLine[];
  /**
   * The value columns over every product, summed exactly and rounded once —
   * not the sum of the rounded lines. Absent when no value was given.
   */
  totalValue?: SummaryFigures;
}

const zero = (): SummaryFigures => ({
  opening: 0,
  delivered: 0,
  sold: 0,
  adjusted: 0,
  closing: 0,
});

function add(
  into: SummaryFigures,
  column: SummaryColumn,
  amount: number,
): void {
  if (column === 'sold') into.sold -= amount;
  else into[column] += amount;
  into.closing += amount;
}

const rounded = (figures: SummaryFigures): SummaryFigures => ({
  opening: Math.round(figures.opening),
  delivered: Math.round(figures.delivered),
  sold: Math.round(figures.sold),
  adjusted: Math.round(figures.adjusted),
  closing: Math.round(figures.closing),
});

/**
 * One line per product that had stock or movement: what it started with
 * (`before`, summed before the period) and the period's movements, grouped by
 * type and reason. A product with nothing either side is left out. Values are
 * carried when every input has one.
 */
export function summariseStock(
  before: ReadonlyMap<string, Amount>,
  during: readonly MovementTotal[],
): StockSummary {
  const valued =
    [...before.values()].every((row) => row.value !== undefined) &&
    during.every((row) => row.value !== undefined);

  const lines = new Map<
    string,
    { productId: string; quantity: SummaryFigures; value: SummaryFigures }
  >();
  const total = zero();

  const lineFor = (productId: string) => {
    let line = lines.get(productId);
    if (!line) {
      const start = before.get(productId);
      line = { productId, quantity: zero(), value: zero() };
      if (start) {
        add(line.quantity, 'opening', start.quantity);
        add(line.value, 'opening', start.value ?? 0);
        add(total, 'opening', start.value ?? 0);
      }
      lines.set(productId, line);
    }
    return line;
  };

  for (const [productId, start] of before) {
    if (start.quantity !== 0) lineFor(productId);
  }
  for (const row of during) {
    const line = lineFor(row.productId);
    const column = columnFor(row.type, row.reason);
    add(line.quantity, column, row.quantity);
    add(line.value, column, row.value ?? 0);
    add(total, column, row.value ?? 0);
  }

  return {
    lines: [...lines.values()].map((line) => ({
      productId: line.productId,
      ...line.quantity,
      ...(valued && { value: rounded(line.value) }),
    })),
    ...(valued && { totalValue: rounded(total) }),
  };
}
