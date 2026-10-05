/**
 * Unpaid, part-paid or paid, from the server's own `balance` and `paid`.
 * Named here, never computed — see `PaidStatus`.
 */
export type PayState = 'unpaid' | 'part' | 'paid';

export function payState(balance: number, paid: number): PayState {
  if (balance <= 0) return 'paid';
  return paid > 0 ? 'part' : 'unpaid';
}

/** The words for each state — one list, for the badge and for a download. */
export const PAY_STATE_LABEL: Record<PayState, string> = {
  unpaid: 'Unpaid',
  part: 'Part-paid',
  paid: 'Paid',
};
