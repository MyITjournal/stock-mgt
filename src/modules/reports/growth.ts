/**
 * Is the business growing? One period's figures beside another's (2026-10-08).
 *
 * Pure. The figures come from the profit report, collections and a count of
 * sales and buyers; this decides only how two of them are compared, so the
 * Home panel and Reports → Growth say the same thing about the same months.
 */

/** Money in minor units; counts are counts. */
export interface GrowthFigures {
  /** Tax-exclusive, net of returns — the profit report's revenue. */
  revenue: number;
  grossProfit: number;
  /** Gross profit over revenue, in basis points. */
  marginBps: number;
  operatingProfit: number;
  /** Money received from customers, whatever invoice it settled. */
  collected: number;
  /** Invoices recorded. */
  sales: number;
  /** Revenue per sale, rounded once. */
  averageSale: number;
  /** Named customers who bought; walk-ins are nobody in particular. */
  customers: number;
  /** Of those, how many bought for the first time ever. */
  newCustomers: number;
}

/** Each figure's change, in basis points (2500 = up 25%); null when none exists. */
export interface GrowthChange {
  revenue: number | null;
  grossProfit: number | null;
  operatingProfit: number | null;
  collected: number | null;
  sales: number | null;
  averageSale: number | null;
  customers: number | null;
  newCustomers: number | null;
  /**
   * The margin's move in **points**, as basis points: 250 means it went from
   * 10.0% to 12.5%. A percentage change of a percentage ("up 25%") would be
   * true and useless.
   */
  marginPoints: number;
}

/**
 * Change from one figure to the next, in basis points.
 *
 * **Null when there is nothing to compare with** — the first month, a month
 * that sold nothing — rather than 0, which would read as "no change". Against
 * a loss, the change is measured on its size, so a loss shrinking from ₦100k
 * to ₦50k reads as up 50%, which is the direction it moved.
 */
export function changeBps(previous: number, current: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 10_000);
}

/** Revenue per sale, rounded once; zero sales has no average, so 0. */
export function averageSale(revenue: number, sales: number): number {
  return sales === 0 ? 0 : Math.round(revenue / sales);
}

export function compareGrowth(
  current: GrowthFigures,
  previous: GrowthFigures,
): GrowthChange {
  const of = (key: keyof GrowthFigures) =>
    changeBps(previous[key], current[key]);
  return {
    revenue: of('revenue'),
    grossProfit: of('grossProfit'),
    operatingProfit: of('operatingProfit'),
    collected: of('collected'),
    sales: of('sales'),
    averageSale: of('averageSale'),
    customers: of('customers'),
    newCustomers: of('newCustomers'),
    marginPoints: current.marginBps - previous.marginBps,
  };
}

/**
 * How many customers bought for the first time in a window, given when each
 * customer first bought at all.
 */
export function countFirstPurchases(
  firstPurchases: Iterable<Date>,
  from: Date,
  to: Date,
): number {
  let count = 0;
  for (const at of firstPurchases) if (at >= from && at < to) count += 1;
  return count;
}
