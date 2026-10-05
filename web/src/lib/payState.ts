/**
 * Unpaid, part-paid or paid, from the server's own `balance` and `paid`.
 * Named here, never computed — see `PaidStatus`.
 */
export type PayState = 'unpaid' | 'part' | 'paid';

export function payState(balance: number, paid: number): PayState {
  if (balance <= 0) return 'paid';
  return paid > 0 ? 'part' : 'unpaid';
}
