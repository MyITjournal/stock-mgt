import { Money } from '../components/Money';
import { Field, Input, MoneyInput, Select } from '../components/Field';
import { Button } from '../components/Button';
import type { Minor } from '../lib/money';
import type { components } from '../api/schema';
import {
  needsBankAccount,
  type PaymentMethod,
  type PaymentState,
} from './payment';

type BankAccount = components['schemas']['BankAccountView'];
type Customer = components['schemas']['CustomerView'];

/**
 * Who is buying, how they are paying, and where the money landed.
 *
 * Three rules from the server are visible in this one panel, and each of them
 * is here because getting it wrong is expensive somewhere far away:
 *
 * - **`transfer` and `pos` must name a bank account; `cash` must not** — and it
 *   is never defaulted for someone who did not choose, because a wrong account
 *   only surfaces weeks later at reconciliation (§11).
 * - **A walk-in has no customer**, and inventing a row for every stranger
 *   paying cash buries the real ones (§4). Blank is the normal case.
 * - **Paying less than the total is credit**, which the server will refuse
 *   outright for a customer who already owes — and refuse for *anybody*
 *   without a customer, since there would be nobody to collect from.
 */
export function PaymentPanel({
  state,
  onChange,
  total,
  customers,
  accounts,
  onSubmit,
  busy,
  canSubmit,
}: {
  state: PaymentState;
  onChange: (next: PaymentState) => void;
  total: Minor;
  customers: Customer[];
  accounts: BankAccount[];
  onSubmit: () => void;
  busy: boolean;
  canSubmit: boolean;
}) {
  const paying = state.amount ?? total;
  const owing = total - paying;
  const requiresAccount = needsBankAccount(state.method);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Payment</h2>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wide text-slate-500">
            Total
          </div>
          <div className="text-2xl font-semibold text-slate-900">
            <Money value={total} />
          </div>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        <Field
          label="Customer"
          htmlFor="customer"
          hint="Leave blank for a walk-in paying cash."
        >
          <Select
            id="customer"
            value={state.customerId ?? ''}
            disabled={busy}
            onChange={(event) =>
              onChange({
                ...state,
                customerId: event.target.value || null,
              })
            }
          >
            <option value="">Walk-in</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {[customer.firstName, customer.lastName]
                  .filter(Boolean)
                  .join(' ')}
                {customer.phone ? ` · ${customer.phone}` : ''}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Method" htmlFor="method">
          <Select
            id="method"
            value={state.method}
            disabled={busy}
            onChange={(event) => {
              const method = event.target.value as PaymentMethod;
              onChange({
                ...state,
                method,
                // Cash must not carry an account, so drop one chosen earlier
                // rather than sending it and being refused.
                bankAccountId: needsBankAccount(method)
                  ? state.bankAccountId
                  : null,
              });
            }}
          >
            <option value="cash">Cash</option>
            <option value="transfer">Transfer</option>
            <option value="pos">POS</option>
            <option value="cheque">Cheque</option>
          </Select>
        </Field>

        {requiresAccount && (
          <Field
            label="Paid into"
            htmlFor="bank-account"
            hint="Which account took the money. Never guessed — a wrong one only shows up at reconciliation."
            error={
              accounts.length === 0
                ? 'No active bank accounts. Add one before taking transfers.'
                : undefined
            }
          >
            <Select
              id="bank-account"
              value={state.bankAccountId ?? ''}
              disabled={busy || accounts.length === 0}
              onChange={(event) =>
                onChange({
                  ...state,
                  bankAccountId: event.target.value || null,
                })
              }
            >
              <option value="">Choose an account…</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.bankName} · {account.accountNumber}
                  {account.isDefault ? ' (default)' : ''}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {state.method !== 'cash' && (
          <Field
            label="Reference"
            htmlFor="reference"
            hint="Optional. The transfer or terminal reference, so it can be matched later."
          >
            <Input
              id="reference"
              value={state.reference}
              disabled={busy}
              onChange={(event) =>
                onChange({ ...state, reference: event.target.value })
              }
              placeholder="FT26083012345"
            />
          </Field>
        )}

        <Field
          label="Amount paid"
          htmlFor="amount"
          hint="Blank means paying in full."
        >
          <MoneyInput
            id="amount"
            value={state.amount}
            disabled={busy}
            onChange={(amount) => onChange({ ...state, amount })}
            placeholder={(total / 100).toFixed(2)}
          />
        </Field>

        {owing > 0 && (
          <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
            <div className="flex justify-between">
              <span>On credit</span>
              <span className="font-medium">
                <Money value={owing} />
              </span>
            </div>
            {!state.customerId && (
              <p className="mt-1 text-xs">
                A sale on credit needs a customer — there has to be somebody to
                collect from.
              </p>
            )}
          </div>
        )}
      </div>

      <Button
        type="button"
        onClick={onSubmit}
        disabled={busy || !canSubmit}
        className="mt-6 h-12 w-full text-base"
      >
        {busy ? 'Recording…' : 'Take payment'}
      </Button>
    </div>
  );
}
