import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Button } from '../components/Button';
import { Field, Input, MoneyInput, Select } from '../components/Field';
import { Money } from '../components/Money';
import { api, ApiError } from '../api/client';
import { useSeesCost } from '../auth/useAuth';
import type { components } from '../api/schema';

type ProductView = components['schemas']['ProductView'];
type SupplierView = components['schemas']['SupplierView'];
type LocationView = components['schemas']['LocationView'];
type BankAccountView = components['schemas']['BankAccountView'];
type GoodsReceiptView = components['schemas']['GoodsReceiptView'];

type Method = 'cash' | 'transfer' | 'pos' | 'cheque';

interface DraftLine {
  /** Minted once, so a retry describes the same line rather than a new one. */
  key: string;
  productId: string;
  unitId: string;
  quantityReceived: string;
  quantityPaidFor: string;
  totalCost: number | null;
  lotCode: string;
  expiryDate: string;
}

function emptyLine(): DraftLine {
  return {
    key: crypto.randomUUID(),
    productId: '',
    unitId: '',
    quantityReceived: '',
    quantityPaidFor: '',
    totalCost: null,
    lotCode: '',
    expiryDate: '',
  };
}

/**
 * Recording a delivery.
 *
 * Four rules from §2 and §16 are visible in this form, and each is the reason
 * a field is shaped the way it is:
 *
 * - **The invoice total is the input, never a per-unit price.** Typing
 *   "45,211.11 × 6" loses a kobo before the calculation starts, so the line
 *   takes what the vendor charged and the unit cost falls out of the division.
 * - **Free goods are not a special case.** Received 20, paid for 19 — the gap
 *   *is* the free goods, and the cost of every unit drops accordingly.
 * - **Quantities are counted in the unit that arrived** (the carton), and
 *   converted to base units once, on the server.
 * - **Every delivery raises a bill.** Paid in full at the door is no exception:
 *   the bill opens and the payment closes it in the same request. That is why
 *   money paid on the spot belongs here rather than in a second visit to the
 *   payables screen.
 */
export function ReceiveDeliveryPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // `SETTLES_DELIVERIES` on the server is owner, manager and accountant — the
  // same three who may see cost. A storekeeper still records the delivery and
  // types the line totals off the invoice; what is *owed* and what was *paid*
  // are decisions rather than transcription.
  const settlesDeliveries = useSeesCost();

  const [supplierId, setSupplierId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [receivedAt, setReceivedAt] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [amountDue, setAmountDue] = useState<number | null>(null);
  const [paying, setPaying] = useState(false);
  const [paidAmount, setPaidAmount] = useState<number | null>(null);
  const [method, setMethod] = useState<Method>('cash');
  const [bankAccountId, setBankAccountId] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);

  // The receipt id is stable across every attempt; each attempt carries its own
  // Idempotency-Key, which `api.post` mints (§8).
  const receiptId = useMemo(() => crypto.randomUUID(), []);

  const { data: products = [] } = useQuery({
    queryKey: ['products', ''],
    queryFn: () => api.get<ProductView[]>('/products'),
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api.get<SupplierView[]>('/suppliers'),
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: () => api.get<LocationView[]>('/locations'),
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: () => api.get<BankAccountView[]>('/bank-accounts'),
    enabled: settlesDeliveries,
  });

  const productById = new Map(products.map((product) => [product.id, product]));

  const setLine = (key: string, patch: Partial<DraftLine>) =>
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );

  const lineIsComplete = (line: DraftLine) =>
    Boolean(line.productId) &&
    Number.isInteger(Number(line.quantityReceived)) &&
    Number(line.quantityReceived) > 0 &&
    line.totalCost !== null;

  const complete = lines.filter(lineIsComplete);
  const goodsTotal = complete.reduce(
    (sum, line) => sum + (line.totalCost ?? 0),
    0,
  );
  const ready = Boolean(supplierId) && complete.length > 0;

  const record = useMutation({
    mutationFn: () =>
      api.post<GoodsReceiptView>('/goods-receipts', {
        id: receiptId,
        supplierId,
        ...(locationId ? { locationId } : {}),
        ...(invoiceNumber.trim() ? { invoiceNumber: invoiceNumber.trim() } : {}),
        ...(receivedAt ? { receivedAt: new Date(receivedAt).toISOString() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(settlesDeliveries && amountDue !== null ? { amountDue } : {}),
        ...(settlesDeliveries && paying && paidAmount
          ? {
              payment: {
                amount: paidAmount,
                method,
                ...(method === 'cash' ? {} : { bankAccountId }),
                ...(reference.trim() ? { reference: reference.trim() } : {}),
              },
            }
          : {}),
        lines: complete.map((line) => {
          const paidFor = Number(line.quantityPaidFor);
          return {
            id: line.key,
            productId: line.productId,
            ...(line.unitId ? { unitId: line.unitId } : {}),
            quantityReceived: Number(line.quantityReceived),
            ...(line.quantityPaidFor !== '' && Number.isInteger(paidFor)
              ? { quantityPaidFor: paidFor }
              : {}),
            totalCost: line.totalCost,
            ...(line.lotCode.trim() ? { lotCode: line.lotCode.trim() } : {}),
            ...(line.expiryDate
              ? { expiryDate: new Date(line.expiryDate).toISOString() }
              : {}),
          };
        }),
      }),
    onSuccess: (receipt) => {
      void queryClient.invalidateQueries({ queryKey: ['goods-receipts'] });
      void queryClient.invalidateQueries({ queryKey: ['stock-levels'] });
      void queryClient.invalidateQueries({ queryKey: ['stock-movements'] });
      void queryClient.invalidateQueries({ queryKey: ['payables'] });
      navigate(`/stock/receipts/${receipt.id}`);
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not record that delivery.',
      ),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (ready) record.mutate();
  };

  return (
    <Page
      title="Record a delivery"
      description="What arrived, counted as it arrived, priced off the vendor's invoice."
      actions={
        <Button variant="secondary" onClick={() => navigate('/stock/receipts')}>
          Cancel
        </Button>
      }
    >
      <form onSubmit={submit} className="space-y-6">
        <section className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-4">
          <Field label="Vendor" htmlFor="receive-supplier">
            <Select
              id="receive-supplier"
              value={supplierId}
              onChange={(event) => setSupplierId(event.target.value)}
              required
            >
              <option value="">Choose a vendor</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Into"
            htmlFor="receive-location"
            hint="Defaults to the main store."
          >
            <Select
              id="receive-location"
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
            >
              <option value="">Default location</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Invoice number" htmlFor="receive-invoice">
            <Input
              id="receive-invoice"
              value={invoiceNumber}
              onChange={(event) => setInvoiceNumber(event.target.value)}
              placeholder="INV-88213"
            />
          </Field>

          <Field
            label="Arrived"
            htmlFor="receive-date"
            hint="Leave blank for now."
          >
            <Input
              id="receive-date"
              type="date"
              value={receivedAt}
              onChange={(event) => setReceivedAt(event.target.value)}
            />
          </Field>

          <div className="sm:col-span-4">
            <Field label="Note" htmlFor="receive-note">
              <Input
                id="receive-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Two cartons dented, accepted anyway."
              />
            </Field>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">
              What arrived
            </h2>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setLines([...lines, emptyLine()])}
            >
              Add a line
            </Button>
          </div>

          <div className="divide-y divide-slate-100">
            {lines.map((line, index) => {
              const product = productById.get(line.productId);
              const units = product?.units ?? [];
              const received = Number(line.quantityReceived);
              const paidFor =
                line.quantityPaidFor === ''
                  ? received
                  : Number(line.quantityPaidFor);
              const free =
                Number.isInteger(received) && Number.isInteger(paidFor)
                  ? received - paidFor
                  : 0;

              return (
                <div key={line.key} className="p-4">
                  <div className="grid gap-3 sm:grid-cols-12">
                    <div className="sm:col-span-4">
                      <Field label="Product" htmlFor={`line-product-${index}`}>
                        <Select
                          id={`line-product-${index}`}
                          value={line.productId}
                          onChange={(event) =>
                            setLine(line.key, {
                              productId: event.target.value,
                              unitId: '',
                            })
                          }
                        >
                          <option value="">Choose a product</option>
                          {products.map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {candidate.name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </div>

                    <div className="sm:col-span-2">
                      <Field label="Counted in" htmlFor={`line-unit-${index}`}>
                        <Select
                          id={`line-unit-${index}`}
                          value={line.unitId}
                          onChange={(event) =>
                            setLine(line.key, { unitId: event.target.value })
                          }
                          disabled={units.length === 0}
                        >
                          <option value="">Base unit</option>
                          {units.map((unit) => (
                            <option key={unit.id} value={unit.id}>
                              {unit.name}
                              {unit.factor === 1 ? '' : ` (${unit.factor})`}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </div>

                    <div className="sm:col-span-2">
                      <Field
                        label="Received"
                        htmlFor={`line-received-${index}`}
                      >
                        <Input
                          id={`line-received-${index}`}
                          inputMode="numeric"
                          value={line.quantityReceived}
                          onChange={(event) =>
                            setLine(line.key, {
                              quantityReceived: event.target.value.replace(
                                /[^\d]/g,
                                '',
                              ),
                            })
                          }
                          placeholder="20"
                        />
                      </Field>
                    </div>

                    <div className="sm:col-span-2">
                      <Field
                        label="Paid for"
                        htmlFor={`line-paid-${index}`}
                        hint={free > 0 ? `${free} free` : undefined}
                      >
                        <Input
                          id={`line-paid-${index}`}
                          inputMode="numeric"
                          value={line.quantityPaidFor}
                          onChange={(event) =>
                            setLine(line.key, {
                              quantityPaidFor: event.target.value.replace(
                                /[^\d]/g,
                                '',
                              ),
                            })
                          }
                          placeholder={line.quantityReceived || '20'}
                        />
                      </Field>
                    </div>

                    <div className="sm:col-span-2">
                      <Field
                        label="Invoice total"
                        htmlFor={`line-total-${index}`}
                      >
                        <MoneyInput
                          id={`line-total-${index}`}
                          value={line.totalCost}
                          onChange={(minor) =>
                            setLine(line.key, { totalCost: minor })
                          }
                          placeholder="0.00"
                        />
                      </Field>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-12">
                    <div className="sm:col-span-4">
                      <Field label="Lot code" htmlFor={`line-lot-${index}`}>
                        <Input
                          id={`line-lot-${index}`}
                          value={line.lotCode}
                          onChange={(event) =>
                            setLine(line.key, { lotCode: event.target.value })
                          }
                          placeholder="Optional"
                        />
                      </Field>
                    </div>

                    <div className="sm:col-span-4">
                      <Field label="Expires" htmlFor={`line-expiry-${index}`}>
                        <Input
                          id={`line-expiry-${index}`}
                          type="date"
                          value={line.expiryDate}
                          onChange={(event) =>
                            setLine(line.key, {
                              expiryDate: event.target.value,
                            })
                          }
                        />
                      </Field>
                    </div>

                    <div className="flex items-end sm:col-span-4">
                      {lines.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() =>
                            setLines(
                              lines.filter(
                                (candidate) => candidate.key !== line.key,
                              ),
                            )
                          }
                        >
                          Remove this line
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm">
            <span className="text-slate-500">
              {complete.length} line{complete.length === 1 ? '' : 's'} ready
            </span>
            <span className="text-slate-900">
              Goods come to <Money value={goodsTotal} />
            </span>
          </div>
        </section>

        {settlesDeliveries && (
          <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-900">
              What the vendor is owed
            </h2>

            <p className="text-xs text-slate-500">
              This delivery raises a bill on <strong>Money → We owe</strong>{' '}
              whether or not anything was paid. It defaults to the goods total;
              override it when the invoice carries a delivery charge or a
              settlement discount that no stock line can hold — that does not
              change what the goods cost.
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Invoice total, if it differs"
                htmlFor="receive-amount-due"
                hint="Leave blank to bill the goods total."
              >
                <MoneyInput
                  id="receive-amount-due"
                  value={amountDue}
                  onChange={setAmountDue}
                  placeholder={(goodsTotal / 100).toFixed(2)}
                />
              </Field>

              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={paying}
                    onChange={(event) => setPaying(event.target.checked)}
                  />
                  <span className="text-slate-700">
                    Money changed hands at the delivery
                  </span>
                </label>
              </div>
            </div>

            {paying && (
              <div className="grid gap-4 rounded-md bg-slate-50 p-3 sm:grid-cols-4">
                <Field label="Paid" htmlFor="receive-paid">
                  <MoneyInput
                    id="receive-paid"
                    value={paidAmount}
                    onChange={setPaidAmount}
                    placeholder="0.00"
                  />
                </Field>

                <Field label="How" htmlFor="receive-method">
                  <Select
                    id="receive-method"
                    value={method}
                    onChange={(event) => {
                      const chosen = event.target.value as Method;
                      setMethod(chosen);
                      if (chosen === 'cash') setBankAccountId('');
                    }}
                  >
                    <option value="cash">Cash</option>
                    <option value="transfer">Transfer</option>
                    <option value="pos">POS</option>
                    <option value="cheque">Cheque</option>
                  </Select>
                </Field>

                <Field
                  label="From which account"
                  htmlFor="receive-account"
                  hint={
                    method === 'cash'
                      ? 'Cash names no account.'
                      : 'Never guessed — a wrong account only surfaces at reconciliation.'
                  }
                >
                  <Select
                    id="receive-account"
                    value={bankAccountId}
                    onChange={(event) => setBankAccountId(event.target.value)}
                    disabled={method === 'cash'}
                    required={method === 'transfer' || method === 'pos'}
                  >
                    <option value="">Choose an account</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.bankName} · {account.accountNumber}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Reference" htmlFor="receive-reference">
                  <Input
                    id="receive-reference"
                    value={reference}
                    onChange={(event) => setReference(event.target.value)}
                    placeholder="FT26091912345"
                  />
                </Field>
              </div>
            )}
          </section>
        )}

        {error && (
          <p
            className="rounded-md bg-red-50 p-3 text-sm text-red-700"
            role="alert"
          >
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate('/stock/receipts')}
            disabled={record.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={record.isPending || !ready}>
            {record.isPending ? 'Recording…' : 'Record delivery'}
          </Button>
        </div>
      </form>
    </Page>
  );
}
