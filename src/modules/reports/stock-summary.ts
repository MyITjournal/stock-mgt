/**
 * Stock in and out over a period, per product (2026-10-07):
 *
 *     opening + delivered − sold ± adjusted = at the end
 *
 * The owner looked at "Decisions somebody made" expecting deliveries in it —
 * that list is only the changes made by hand — and asked for the whole story
 * per item. Every movement in the window lands in **exactly one** column, so
 * the line always adds up; the end is never worked out separately and hoped
 * to agree. Quantities only, in base units: no cost, so nothing to redact.
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

export interface MovementTotal {
  productId: string;
  type: StockMovementType;
  reason: StockAdjustmentReason | null;
  /** Signed base units, summed. */
  quantity: number;
}

export interface SummaryLine {
  productId: string;
  opening: number;
  delivered: number;
  /** Goods gone: sales less returns, as a positive number. */
  sold: number;
  /** Signed. */
  adjusted: number;
  closing: number;
}

/**
 * One line per product that had stock or movement: what it started with
 * (`before`, summed before the period) and the period's movements, grouped by
 * type and reason. A product with nothing either side is left out.
 */
export function summariseStock(
  before: ReadonlyMap<string, number>,
  during: readonly MovementTotal[],
): SummaryLine[] {
  const lines = new Map<string, SummaryLine>();
  const lineFor = (productId: string) => {
    let line = lines.get(productId);
    if (!line) {
      const start = before.get(productId) ?? 0;
      line = {
        productId,
        opening: start,
        delivered: 0,
        sold: 0,
        adjusted: 0,
        closing: start,
      };
      lines.set(productId, line);
    }
    return line;
  };

  for (const [productId, quantity] of before) {
    if (quantity !== 0) lineFor(productId);
  }
  for (const row of during) {
    const line = lineFor(row.productId);
    const column = columnFor(row.type, row.reason);
    if (column === 'sold') line.sold -= row.quantity;
    else line[column] += row.quantity;
    line.closing += row.quantity;
  }

  return [...lines.values()];
}
