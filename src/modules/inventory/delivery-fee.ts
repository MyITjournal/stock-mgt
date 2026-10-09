/**
 * A delivery fee, shared across what it brought (2026-10-09).
 *
 * The driver's ₦5,000 is part of what the goods cost to get onto the shelf, so
 * each line carries a share of it and its lot's total includes that share.
 * What the vendor charged stays on the line as it was.
 *
 * **By value**: a ₦200,000 line carries twice the fee of a ₦100,000 line.
 * When every line is ₦0 — free goods only — by what arrived instead, so the
 * fee still lands somewhere. A line where nothing arrived carries none: a lot
 * of zero units with a cost would divide by zero the moment anyone asked what
 * one costs.
 *
 * The shares are whole kobo and **add up to exactly the fee**: each line gets
 * the rounded-down part of its share, and the kobo left over go one each to
 * the lines with the largest remainders (ties to the earlier line). So no
 * rounding ever makes or loses money, the same rule as §2.
 *
 * Kept pure, like `delivery-correction.ts`, so it is tested without a
 * database.
 */
export function splitDeliveryFee(
  fee: number,
  lines: readonly { totalCost: number; quantityReceived: number }[],
): number[] {
  if (fee <= 0 || lines.length === 0) return lines.map(() => 0);

  const byValue = lines.map((line) =>
    line.quantityReceived > 0 ? line.totalCost : 0,
  );
  const weights = byValue.some((weight) => weight > 0)
    ? byValue
    : lines.map((line) => Math.max(line.quantityReceived, 0));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total === 0) {
    throw new Error('A delivery fee needs something that arrived to cost.');
  }

  // In BigInt: a ₦50,000 fee on a ₦20m line is 10¹⁶ kobo², past what a
  // double holds exactly.
  const big = BigInt(fee);
  const whole = BigInt(total);
  const parts = weights.map((weight) => big * BigInt(weight));
  const shares = parts.map((part) => Number(part / whole));
  let left = fee - shares.reduce((sum, share) => sum + share, 0);

  const byRemainder = parts
    .map((part, index) => ({ index, remainder: part % whole }))
    .filter((row) => weights[row.index] > 0)
    .sort(
      (a, b) =>
        (a.remainder < b.remainder ? 1 : a.remainder > b.remainder ? -1 : 0) ||
        a.index - b.index,
    );
  for (const row of byRemainder) {
    if (left === 0) break;
    shares[row.index] += 1;
    left -= 1;
  }
  return shares;
}

/** Whether anything on the delivery arrived, so a fee has somewhere to go. */
export function feeHasSomewhereToGo(
  lines: readonly { quantityReceived: number }[],
): boolean {
  return lines.some((line) => line.quantityReceived > 0);
}
