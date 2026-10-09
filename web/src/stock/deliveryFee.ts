import type { components } from '../api/schema';

type GoodsReceiptView = components['schemas']['GoodsReceiptView'];

export type FeeMethod = 'cash' | 'transfer' | 'pos' | 'cheque';

/** The delivery fee as the form holds it. */
export interface FeeDraft {
  amount: number | null;
  method: FeeMethod;
  bankAccountId: string;
  paidTo: string;
  /** Whose cash it came out of; '' means whoever recorded the delivery. */
  paidByUserId: string;
}

export const NO_FEE: FeeDraft = {
  amount: null,
  method: 'cash',
  bankAccountId: '',
  paidTo: '',
  paidByUserId: '',
};

/** A recorded delivery's fee, to seed a correction with. */
export function feeOf(receipt: GoodsReceiptView): FeeDraft {
  return {
    amount: receipt.deliveryFee ? receipt.deliveryFee : null,
    method: receipt.deliveryFeeMethod ?? 'cash',
    bankAccountId: receipt.deliveryFeeBankAccountId ?? '',
    paidTo: receipt.deliveryFeePaidTo ?? '',
    paidByUserId: receipt.deliveryFeePaidByUserId ?? '',
  };
}

/** What a fee draft sends as `deliveryFee`. An empty amount is no fee. */
export function feeBody(fee: FeeDraft) {
  return {
    amount: fee.amount ?? 0,
    method: fee.method,
    ...(fee.method === 'cash' ? {} : { bankAccountId: fee.bankAccountId }),
    ...(fee.paidTo.trim() ? { paidTo: fee.paidTo.trim() } : {}),
    ...(fee.method === 'cash' && fee.paidByUserId
      ? { paidByUserId: fee.paidByUserId }
      : {}),
  };
}

/** Whether a fee draft is complete enough to send. */
export function feeReady(fee: FeeDraft): boolean {
  return (
    !fee.amount ||
    fee.method === 'cash' ||
    fee.method === 'cheque' ||
    fee.bankAccountId !== ''
  );
}
