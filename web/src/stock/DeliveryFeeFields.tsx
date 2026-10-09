import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { components } from '../api/schema';
import { Field, Input, MoneyInput, Select } from '../components/Field';
import { personName } from '../money/cashNames';
import type { FeeDraft, FeeMethod } from './deliveryFee';

type BankAccountView = components['schemas']['BankAccountView'];
type StaffMemberView = components['schemas']['StaffMemberView'];

/**
 * The driver's fee for a delivery (2026-10-09) — on Record a delivery and on
 * Correct this delivery, owner, manager or accountant only.
 *
 * **Part of what the goods cost**, not an expense and not on the vendor's
 * bill. The server splits it across the lines by value and puts each share
 * on the lot; the browser works none of that out, so what each item cost
 * with delivery is shown on the delivery's own page once it is saved.
 *
 * For cash, whose cash paid it — so Money → Cash counts it as paid out by
 * them. Left as "whoever recorded the delivery", the server takes the person
 * who was at the door. The account is never pre-picked, as everywhere.
 */
export function DeliveryFeeFields({
  fee,
  onChange,
  idPrefix,
  recorderLabel = 'Whoever recorded the delivery',
}: {
  fee: FeeDraft;
  onChange: (next: FeeDraft) => void;
  idPrefix: string;
  recorderLabel?: string;
}) {
  const set = (patch: Partial<FeeDraft>) => onChange({ ...fee, ...patch });

  const { data: accounts = [] } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: () => api.get<BankAccountView[]>('/bank-accounts'),
  });
  const { data: staff = [] } = useQuery({
    queryKey: ['staff'],
    queryFn: () => api.get<StaffMemberView[]>('/staff'),
  });
  const people = staff.filter((member) => member.status === 'active');

  return (
    <div className="grid gap-4 sm:grid-cols-4">
      <Field
        label="Delivery fee"
        htmlFor={`${idPrefix}-amount`}
        hint="What the driver was paid. Leave blank if nothing."
      >
        <MoneyInput
          id={`${idPrefix}-amount`}
          value={fee.amount}
          onChange={(amount) => set({ amount })}
          placeholder="0.00"
        />
      </Field>

      <Field label="How it was paid" htmlFor={`${idPrefix}-method`}>
        <Select
          id={`${idPrefix}-method`}
          value={fee.method}
          onChange={(event) => {
            const method = event.target.value as FeeMethod;
            set({
              method,
              ...(method === 'cash' ? { bankAccountId: '' } : {}),
              ...(method !== 'cash' ? { paidByUserId: '' } : {}),
            });
          }}
        >
          <option value="cash">Cash</option>
          <option value="transfer">Transfer</option>
          <option value="pos">POS</option>
          <option value="cheque">Cheque</option>
        </Select>
      </Field>

      {fee.method === 'cash' ? (
        <Field
          label="Whose cash"
          htmlFor={`${idPrefix}-paid-by`}
          hint="Counted as paid out by them on Money → Cash."
        >
          <Select
            id={`${idPrefix}-paid-by`}
            value={fee.paidByUserId}
            onChange={(event) => set({ paidByUserId: event.target.value })}
          >
            <option value="">{recorderLabel}</option>
            {people.map((member) => (
              <option key={member.user.id} value={member.user.id}>
                {personName(member.user)}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <Field
          label="From which account"
          htmlFor={`${idPrefix}-account`}
          hint="Never guessed — a wrong account only surfaces at reconciliation."
        >
          <Select
            id={`${idPrefix}-account`}
            value={fee.bankAccountId}
            onChange={(event) => set({ bankAccountId: event.target.value })}
            required={
              Boolean(fee.amount) &&
              (fee.method === 'transfer' || fee.method === 'pos')
            }
          >
            <option value="">Choose an account</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.bankName} · {account.accountNumber}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Field label="Paid to" htmlFor={`${idPrefix}-paid-to`}>
        <Input
          id={`${idPrefix}-paid-to`}
          value={fee.paidTo}
          onChange={(event) => set({ paidTo: event.target.value })}
          placeholder="Musa (driver)"
        />
      </Field>
    </div>
  );
}
