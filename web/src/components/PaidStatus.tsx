import { payState, type PayState } from '../lib/payState';

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
const LOOK: Record<PayState, { label: string; className: string }> = {
  unpaid: { label: 'Unpaid', className: 'bg-amber-100 text-amber-900' },
  part: { label: 'Part-paid', className: 'bg-sky-100 text-sky-900' },
  paid: { label: 'Paid', className: 'bg-emerald-100 text-emerald-900' },
};

export function PaidStatus({
  balance,
  paid,
}: {
  balance: number;
  paid: number;
}) {
  const look = LOOK[payState(balance, paid)];
  return (
    <span
      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${look.className}`}
    >
      {look.label}
    </span>
  );
}
