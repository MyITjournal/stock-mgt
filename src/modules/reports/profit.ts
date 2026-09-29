/**
 * What the business actually made, kept pure so the arithmetic can be tested
 * without a database — the same reasoning as `money.ts` and `sale-pricing.ts`.
 *
 * Two rules decide every number here, and both are easy to get wrong:
 *
 * **Revenue is tax-exclusive.** Prices are stored VAT-inclusive (§2), so the
 * total on an invoice contains money that belongs to the tax authority. Count
 * it as revenue and every margin is overstated by the VAT rate — 7.5% of
 * turnover that was never the business's to keep. `Sale.taxTotal` is already
 * frozen on the row, so the subtraction is exact rather than re-derived.
 *
 * **A return reduces the period it happened in**, not the period of the sale it
 * reverses. Restating a month that has already been read and acted on is what
 * accounting does; this is not accounting (§1). The refund and the cost of the
 * goods coming back both land on the day the customer walked in.
 *
 * This is a management figure, not a P&L. There is no depreciation, no
 * accruals, and no allocation of overhead to products. It answers "did I make
 * money this month", which is the question actually being asked.
 */
import { Minor, splitTaxInclusive } from '../../common/money/money';

export interface SoldInPeriod {
  /** Tax-inclusive, as stored. */
  total: Minor;
  /** The VAT inside `total`, frozen at the time of sale. */
  taxTotal: Minor;
  /** Cost of the goods, rounded once when the sale was made. */
  costTotal: Minor;
}

export interface ReturnedInPeriod {
  /** Tax-inclusive refund, as stored. */
  refundAmount: Minor;
  /** Cost of the goods that came back. */
  costAmount: Minor;
  /** The rate the original line carried, so its VAT can be unwound exactly. */
  taxRateBps: number;
}

export interface Profit {
  /** Tax-exclusive, net of returns. The honest top line. */
  revenue: Minor;
  /** Tax-inclusive turnover before returns — what the invoices added up to. */
  grossSales: Minor;
  /** VAT inside the sales, less VAT unwound by returns. */
  tax: Minor;
  /** Tax-inclusive value of what came back. */
  returned: Minor;
  /** Cost of goods sold, less the cost of goods returned. */
  cogs: Minor;
  /** `revenue − cogs`. */
  grossProfit: Minor;
  expenses: Minor;
  /** `grossProfit − expenses`. */
  operatingProfit: Minor;
  /** Gross margin in basis points, so it stays an integer (750 = 7.5%). */
  marginBps: number;
}

export function computeProfit(input: {
  sales: readonly SoldInPeriod[];
  returns: readonly ReturnedInPeriod[];
  expenses: readonly { amount: Minor }[];
}): Profit {
  const grossSales = sum(input.sales.map((sale) => sale.total));
  const salesTax = sum(input.sales.map((sale) => sale.taxTotal));
  const soldCost = sum(input.sales.map((sale) => sale.costTotal));

  const returned = sum(input.returns.map((row) => row.refundAmount));
  const returnedCost = sum(input.returns.map((row) => row.costAmount));
  // A return carries no stored tax of its own; it is derived from the refund at
  // the rate the line was sold under, which is exactly how the sale derived it.
  const returnedTax = sum(
    input.returns.map(
      (row) => splitTaxInclusive(row.refundAmount, row.taxRateBps).tax,
    ),
  );

  const revenue = grossSales - salesTax - (returned - returnedTax);
  const cogs = soldCost - returnedCost;
  const grossProfit = revenue - cogs;
  const expenses = sum(input.expenses.map((row) => row.amount));

  return {
    revenue,
    grossSales,
    tax: salesTax - returnedTax,
    returned,
    cogs,
    grossProfit,
    expenses,
    operatingProfit: grossProfit - expenses,
    marginBps: marginBps(grossProfit, revenue),
  };
}

/**
 * Margin as a share of revenue, in basis points.
 *
 * Zero revenue yields zero rather than a division by zero: a month with no
 * sales has no margin, and reporting `NaN` to a dashboard helps nobody.
 */
export function marginBps(grossProfit: Minor, revenue: Minor): number {
  if (revenue === 0) return 0;
  return Math.round((grossProfit / revenue) * 10_000);
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
