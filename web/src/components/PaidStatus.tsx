import { PAY_STATE_LABEL, payState, type PayState } from '../lib/payState';

/**
 * Unpaid, part-paid or paid — for a customer invoice or a vendor bill.
 *
 * **Read from the server's own figures, never worked out here.** `balance` is
 * what is still owed and `paid` what has been paid against it; both come back
 * from the server, which decides what counts — voided payments do not
 * (`LIVE_ALLOCATIONS`, `LIVE_SUPPLIER_PAYMENTS`). This only names the state
 * those two numbers are already in, so the label and the amounts beside it
 * cannot disagree.
 */
const TONE: Record<PayState, string> = {
  unpaid: 'bg-amber-100 text-amber-900',
  part: 'bg-sky-100 text-sky-900',
  paid: 'bg-emerald-100 text-emerald-900',
};

export function PaidStatus({
  balance,
  paid,
}: {
  balance: number;
  paid: number;
}) {
  const state = payState(balance, paid);
  return (
    <span
      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TONE[state]}`}
    >
      {PAY_STATE_LABEL[state]}
    </span>
  );
}
