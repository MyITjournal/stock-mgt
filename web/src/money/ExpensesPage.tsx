import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Money } from '../components/Money';
import { Button } from '../components/Button';
import { Field, Input, MoneyInput, Select } from '../components/Field';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import type { PaymentMethod } from '../till/payment';
import type { components } from '../api/schema';

type ExpenseListView = components['schemas']['ExpenseListView'];
type ExpenseView = components['schemas']['ExpenseView'];
type ExpenseCategoryView = components['schemas']['ExpenseCategoryView'];
type SupplierView = { id: string; name: string };

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
 */
export function ExpensesPage() {
  const [adding, setAdding] = useState(false);

  const { data, isPending } = useQuery({
    queryKey: ['expenses'],
    // No cursor and no `since`, so this is the browsing read: ordered by
    // occurredAt, newest first, with no sync lag. This endpoint had that split
    // right before sales and payments were taught it.
    queryFn: () => api.get<ExpenseListView>('/expenses'),
  });

  return (
    <Page
      title="Expenses"
      description="Money out that is not stock."
      actions={<Button onClick={() => setAdding(true)}>Record an expense</Button>}
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

          {data.byCategory.length > 0 && (
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

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">When</th>
              <th className="px-4 py-2 font-medium">Category</th>
              <th className="px-4 py-2 font-medium">Paid to</th>
              <th className="px-4 py-2 font-medium">Method</th>
              <th className="px-4 py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {!isPending && data?.expenses.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  Nothing recorded yet.
                </td>
              </tr>
            )}
            {data?.expenses.map((expense: ExpenseView) => (
              <tr key={expense.id}>
                <td className="px-4 py-3 text-slate-600">
                  {new Date(expense.occurredAt).toLocaleDateString('en-NG')}
                </td>
                <td className="px-4 py-3 text-slate-900">
                  {expense.category.name}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {expense.supplier?.name ?? '—'}
                </td>
                <td className="px-4 py-3 text-slate-600">{expense.method}</td>
                <td className="px-4 py-3 text-right font-medium">
                  <Money value={expense.amount} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adding && <ExpenseDialog onClose={() => setAdding(false)} />}
    </Page>
  );
}

function ExpenseDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [supplierId, setSupplierId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: categories = [] } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: () => api.get<ExpenseCategoryView[]>('/expense-categories'),
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api.get<SupplierView[]>('/suppliers'),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<ExpenseView>('/expenses', {
        id: crypto.randomUUID(),
        categoryId,
        amount: amount ?? 0,
        method,
        ...(supplierId && { supplierId }),
        ...(note.trim() && { note: note.trim() }),
      }),
    onSuccess: () => {
      afterWrite(queryClient);
      onClose();
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not record that expense.',
      ),
  });

  const ready = Boolean(categoryId) && (amount ?? 0) > 0;

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
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-lg"
      >
        <h2 id="expense-title" className="text-lg font-semibold text-slate-900">
          Record an expense
        </h2>

        {/* The §16 trap, said out loud where somebody is about to fall into it.
            Paying a vendor for stock already reaches profit through cost of
            goods sold; recording it again here counts the money twice. */}
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          Not for paying a supplier for stock — that goes through{' '}
          <strong>We owe</strong>. Recording it here as well would count the
          same money twice and make every margin look worse than it is.
        </p>

        <div className="mt-4 space-y-4">
          <Field label="What for" htmlFor="expense-category">
            <Select
              id="expense-category"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              autoFocus
              required
            >
              <option value="">Choose a category…</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </Field>

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

          <Field
            label="Paid to"
            htmlFor="expense-supplier"
            hint="Optional, and for the record only — it settles no bill."
          >
            <Select
              id="expense-supplier"
              value={supplierId}
              onChange={(event) => setSupplierId(event.target.value)}
            >
              <option value="">Nobody in particular</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Note" htmlFor="expense-note">
            <Input
              id="expense-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Diesel for the generator."
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
            {create.isPending ? 'Saving…' : 'Record expense'}
          </Button>
        </div>
      </form>
    </div>
  );
}
