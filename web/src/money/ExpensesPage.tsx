import { useState, type FormEvent } from 'react';
import { DialogClose } from '../components/DialogClose';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Money } from '../components/Money';
import { Button } from '../components/Button';
import { Field, Input, MoneyInput, Select } from '../components/Field';
import { PaidOnField } from '../components/PaidOnField';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import { occurredAtFor, today } from '../lib/paidOn';
import type { PaymentMethod } from '../till/payment';
import type { components } from '../api/schema';

type ExpenseListView = components['schemas']['ExpenseListView'];
type ExpenseView = components['schemas']['ExpenseView'];
type ExpenseCategoryView = components['schemas']['ExpenseCategoryView'];

/** `other` is the Expenses screen, `salaries` the Salaries screen. */
type Kind = 'other' | 'salaries';

/**
 * Money going out that is **not** the cost of goods.
 *
 * Rent, fuel, the generator. Expenses exist so the profit view has both halves
 * of its subtraction — cost of goods sold comes off the sale lines, and
 * everything else comes from here.
 *
 * **The trap this screen has to resist: a supplier payment is never an
 * expense** (DECISIONS.md §16). Buying stock already reaches profit through
 * cost of goods sold, so logging a vendor payment here counts the same money
 * twice and understates every margin — quietly, and in a way that only shows up
 * as margins that look worse than the shop knows they are. The form says so,
 * and points at the right place.
 *
 * **Who was paid is typed, and required** (2026-10-06). It used to be a pick
 * from the vendor list defaulting to "Nobody in particular" — vendors are paid
 * through bills, so the list offered the wrong people, and the default told
 * nobody anything. Names already used are offered as suggestions.
 */
export function ExpensesPage() {
  return <SpendingPage kind="other" />;
}

/**
 * Pay to staff, on its own screen (2026-10-06).
 *
 * **Still an expense, on purpose.** A salary is recorded into the shop's one
 * salaries category, so profit still takes it off — a month that paid ₦300,000
 * in wages did not make that ₦300,000 — and the profit report shows it on its
 * own line. What changes is that it is no longer mixed in with diesel. No
 * payslips, deductions or pension: those are where payroll software starts.
 */
export function SalariesPage() {
  return <SpendingPage kind="salaries" />;
}

const COPY: Record<
  Kind,
  { title: string; description: string; action: string; empty: string }
> = {
  other: {
    title: 'Expenses',
    description: 'Money out that is not stock or salaries.',
    action: 'Record an expense',
    empty: 'Nothing recorded yet.',
  },
  salaries: {
    title: 'Salaries',
    description:
      'Pay to staff. Counted in profit on its own line, in the month it was paid.',
    action: 'Pay a salary',
    empty: 'No salaries recorded yet.',
  },
};

function SpendingPage({ kind }: { kind: Kind }) {
  const [adding, setAdding] = useState(false);
  const copy = COPY[kind];

  const { data, isPending } = useQuery({
    queryKey: ['expenses', kind],
    // No cursor and no `since`, so this is the browsing read: ordered by
    // occurredAt, newest first, with no sync lag. This endpoint had that split
    // right before sales and payments were taught it.
    queryFn: () => api.get<ExpenseListView>(`/expenses?kind=${kind}`),
  });

  // Every name already paid on this screen, most recent first, for the
  // suggestions under "Paid to".
  const payees = [
    ...new Set(
      (data?.expenses ?? [])
        .map((expense) => expense.paidTo)
        .filter((name): name is string => Boolean(name)),
    ),
  ];

  return (
    <Page
      title={copy.title}
      description={copy.description}
      actions={<Button onClick={() => setAdding(true)}>{copy.action}</Button>}
    >
      {data && (
        <div className="mb-6 grid gap-4 sm:grid-cols-[16rem_1fr]">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Total
            </div>
            <div className="mt-1 text-3xl font-semibold text-slate-900">
              <Money value={data.total} />
            </div>
            <div className="mt-1 text-xs text-slate-400">
              Everything matching the filter, not just this page.
            </div>
          </div>

          {kind === 'other' && data.byCategory.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500">
                By category
              </div>
              <ul className="mt-2 space-y-1 text-sm">
                {data.byCategory.slice(0, 5).map((row) => (
                  <li key={row.categoryId} className="flex justify-between">
                    <span className="text-slate-600">{row.name}</span>
                    <Money value={row.total} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {isPending && <p className="text-sm text-slate-500">Loading…</p>}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">When</th>
              {kind === 'other' && (
                <th className="px-4 py-2 font-medium">Category</th>
              )}
              <th className="px-4 py-2 font-medium">Paid to</th>
              <th className="px-4 py-2 font-medium">Method</th>
              <th className="px-4 py-2 font-medium">Note</th>
              <th className="px-4 py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {!isPending && data?.expenses.length === 0 && (
              <tr>
                <td
                  colSpan={kind === 'other' ? 6 : 5}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  {copy.empty}
                </td>
              </tr>
            )}
            {data?.expenses.map((expense: ExpenseView) => (
              <tr key={expense.id}>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                  {new Date(expense.occurredAt).toLocaleDateString('en-NG')}
                </td>
                {kind === 'other' && (
                  <td className="px-4 py-3 text-slate-900">
                    {expense.category.name}
                  </td>
                )}
                <td className="px-4 py-3 text-slate-900">
                  {/* Older rows named a vendor, or nobody. */}
                  {expense.paidTo ?? expense.supplier?.name ?? '—'}
                </td>
                <td className="px-4 py-3 text-slate-600">{expense.method}</td>
                <td className="px-4 py-3 text-slate-600">
                  {expense.note ?? ''}
                </td>
                <td className="px-4 py-3 text-right font-medium">
                  <Money value={expense.amount} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adding && (
        <SpendingDialog
          kind={kind}
          payees={payees}
          onClose={() => setAdding(false)}
        />
      )}
    </Page>
  );
}

function SpendingDialog({
  kind,
  payees,
  onClose,
}: {
  kind: Kind;
  payees: string[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const salaries = kind === 'salaries';
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState<PaymentMethod>(
    salaries ? 'transfer' : 'cash',
  );
  const [paidTo, setPaidTo] = useState('');
  const [paidOn, setPaidOn] = useState(today);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: categories = [] } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: () => api.get<ExpenseCategoryView[]>('/expense-categories'),
  });
  // Salaries record into the shop's one salaries category, which the
  // Expenses picker leaves out so pay is never filed as diesel.
  const salariesCategory = categories.find((category) => category.isSalaries);
  const choices = categories.filter((category) => !category.isSalaries);
  const chosenCategory = salaries ? (salariesCategory?.id ?? '') : categoryId;

  const create = useMutation({
    mutationFn: () =>
      api.post<ExpenseView>('/expenses', {
        id: crypto.randomUUID(),
        categoryId: chosenCategory,
        amount: amount ?? 0,
        method,
        paidTo: paidTo.trim(),
        ...occurredAtFor(paidOn),
        ...(note.trim() && { note: note.trim() }),
      }),
    onSuccess: () => {
      afterWrite(queryClient);
      onClose();
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError ? caught.message : 'Could not record that.',
      ),
  });

  const ready =
    Boolean(chosenCategory) && (amount ?? 0) > 0 && paidTo.trim().length > 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (ready) create.mutate();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="expense-title"
    >
      <form
        onSubmit={submit}
        className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-lg"
      >
        <DialogClose onClose={onClose} />

        <h2 id="expense-title" className="text-lg font-semibold text-slate-900">
          {salaries ? 'Pay a salary' : 'Record an expense'}
        </h2>

        {/* The §16 trap, said out loud where somebody is about to fall into it.
            Paying a vendor for stock already reaches profit through cost of
            goods sold; recording it again here counts the money twice. */}
        {!salaries && (
          <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            Not for paying a supplier for stock — that goes through{' '}
            <strong>Bills</strong>. Recording it here as well would count the
            same money twice and make every margin look worse than it is.
            Salaries have their own tab.
          </p>
        )}

        <div className="mt-4 space-y-4">
          <Field
            label="Paid to"
            htmlFor="expense-paid-to"
            hint={
              salaries
                ? 'The member of staff.'
                : 'Who received the money — the landlord, the mechanic, the filling station.'
            }
          >
            <Input
              id="expense-paid-to"
              value={paidTo}
              onChange={(event) => setPaidTo(event.target.value)}
              list="expense-payees"
              maxLength={120}
              autoFocus
              required
            />
            <datalist id="expense-payees">
              {payees.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </Field>

          {!salaries && (
            <Field label="What for" htmlFor="expense-category">
              <Select
                id="expense-category"
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
                required
              >
                <option value="">Choose a category…</option>
                {choices.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field label="Amount" htmlFor="expense-amount">
            <MoneyInput
              id="expense-amount"
              value={amount}
              onChange={setAmount}
            />
          </Field>

          <Field label="Method" htmlFor="expense-method">
            <Select
              id="expense-method"
              value={method}
              onChange={(event) =>
                setMethod(event.target.value as PaymentMethod)
              }
            >
              <option value="cash">Cash</option>
              <option value="transfer">Transfer</option>
              <option value="pos">POS</option>
              <option value="cheque">Cheque</option>
            </Select>
          </Field>

          <PaidOnField
            id="expense-paid-on"
            value={paidOn}
            onChange={setPaidOn}
          />

          <Field label="Note" htmlFor="expense-note">
            <Input
              id="expense-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={
                salaries ? 'September salary.' : 'Diesel for the generator.'
              }
            />
          </Field>
        </div>

        {error && (
          <p
            className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700"
            role="alert"
          >
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={create.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending || !ready}>
            {create.isPending
              ? 'Saving…'
              : salaries
                ? 'Record salary'
                : 'Record expense'}
          </Button>
        </div>
      </form>
    </div>
  );
}
