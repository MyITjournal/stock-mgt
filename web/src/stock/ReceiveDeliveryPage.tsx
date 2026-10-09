import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Page } from '../components/Layout';
import { Button } from '../components/Button';
import { Field, Input, MoneyInput, Select } from '../components/Field';
import { Money } from '../components/Money';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import { useAuth, useSeesCost } from '../auth/useAuth';
import {
  clearDraft,
  keptAt,
  useKeepDraft,
  useRestoredDraft,
} from '../lib/draft';
import type { components } from '../api/schema';
import { decimalDraft, toWholeBaseUnits } from '../lib/decimalQuantity';
import { choiceValue, stockChoices } from '../lib/options';
import { DeliveryFeeFields } from './DeliveryFeeFields';
import { NO_FEE, feeBody, feeReady, type FeeDraft } from './deliveryFee';

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
  /**
   * The option that arrived, for a product with options. Optional because a
   * draft kept before options existed has none.
   */
  variantId?: string | null;
  unitId: string;
  quantityReceived: string;
  quantityPaidFor: string;
  totalCost: number | null;
  lotCode: string;
  expiryDate: string;
}

/** Everything on the form, as kept in the browser until it is saved. */
interface DeliveryDraft {
  receiptId: string;
  supplierId: string;
  locationId: string;
  invoiceNumber: string;
  receivedAt: string;
  note: string;
  lines: DraftLine[];
  amountDue: number | null;
  paying: boolean;
  paidAmount: number | null;
  method: Method;
  bankAccountId: string;
  reference: string;
  /** Optional because a draft kept before 2026-10-09 has none. */
  fee?: FeeDraft;
}

interface ReadLine {
  /** What to send: the unit and whole counts in it. */
  unitId?: string;
  received: number;
  paidFor?: number;
  /** In base units, for the free-goods hint. */
  freeBase: number;
  baseName: string;
  error?: string;
}

/**
 * A line's quantities as they will be sent. Whole numbers go as typed, in the
 * unit chosen. **A decimal — 6.5 cartons, "half a slot" — goes as the whole
 * number of base units it is** (6.5 × 14 = 91 pieces), and one that is not
 * whole in base units is refused with the reason (DECISIONS.md §15).
 */
function readLine(
  line: DraftLine,
  units: readonly { id: string; name: string; factor: number }[],
): ReadLine | null {
  if (line.quantityReceived === '') return null;
  const base = units.find((unit) => unit.factor === 1);
  const baseName = base?.name ?? 'pieces';
  const unit = units.find((candidate) => candidate.id === line.unitId) ??
    base ?? {
      id: '',
      name: baseName,
      factor: 1,
    };
  const received = toWholeBaseUnits(
    line.quantityReceived,
    unit.factor,
    unit.name,
    baseName,
  );
  const paidText =
    line.quantityPaidFor === '' ? line.quantityReceived : line.quantityPaidFor;
  const paid = toWholeBaseUnits(paidText, unit.factor, unit.name, baseName);
  if ('error' in received)
    return { received: 0, freeBase: 0, baseName, error: received.error };
  if ('error' in paid)
    return { received: 0, freeBase: 0, baseName, error: paid.error };
  if (paid.base > received.base) {
    return {
      received: 0,
      freeBase: 0,
      baseName,
      error: 'More paid for than received.',
    };
  }

  const whole =
    received.base % unit.factor === 0 && paid.base % unit.factor === 0;
  return whole
    ? {
        ...(line.unitId ? { unitId: line.unitId } : {}),
        received: received.base / unit.factor,
        ...(line.quantityPaidFor !== ''
          ? { paidFor: paid.base / unit.factor }
          : {}),
        freeBase: received.base - paid.base,
        baseName,
      }
    : {
        ...(base ? { unitId: base.id } : {}),
        received: received.base,
        paidFor: paid.base,
        freeBase: received.base - paid.base,
        baseName,
      };
}

function emptyLine(): DraftLine {
  return {
    key: crypto.randomUUID(),
    productId: '',
    variantId: null,
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

  // An invoice being typed in is kept in this browser until it is saved, so a
  // failed save or a refresh brings it back rather than losing it (2026-10-07).
  const { user } = useAuth();
  const draftKey = user ? `delivery.${user.organizationId}` : null;
  const draft = useRestoredDraft<DeliveryDraft>(draftKey);
  const kept = draft.restored?.value;

  const [supplierId, setSupplierId] = useState(kept?.supplierId ?? '');
  const [locationId, setLocationId] = useState(kept?.locationId ?? '');
  const [invoiceNumber, setInvoiceNumber] = useState(kept?.invoiceNumber ?? '');
  const [receivedAt, setReceivedAt] = useState(kept?.receivedAt ?? '');
  const [note, setNote] = useState(kept?.note ?? '');
  const [lines, setLines] = useState<DraftLine[]>(
    kept?.lines.length ? kept.lines : [emptyLine()],
  );
  const [amountDue, setAmountDue] = useState<number | null>(
    kept?.amountDue ?? null,
  );
  const [paying, setPaying] = useState(kept?.paying ?? false);
  const [paidAmount, setPaidAmount] = useState<number | null>(
    kept?.paidAmount ?? null,
  );
  const [method, setMethod] = useState<Method>(kept?.method ?? 'cash');
  const [bankAccountId, setBankAccountId] = useState(kept?.bankAccountId ?? '');
  const [reference, setReference] = useState(kept?.reference ?? '');
  const [fee, setFee] = useState<FeeDraft>(kept?.fee ?? NO_FEE);
  const [error, setError] = useState<string | null>(null);

  // The receipt id is stable across every attempt; each attempt carries its own
  // Idempotency-Key, which `api.post` mints (§8).
  // Restored with the draft, so a retry after a lost reply is the same
  // delivery and can never be recorded twice.
  const receiptId = useMemo(
    () => kept?.receiptId ?? crypto.randomUUID(),
    [kept?.receiptId],
  );

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
  // One choice per option — "Eva Soap — Gold" is chosen like a product.
  const choices = stockChoices(products);

  const setLine = (key: string, patch: Partial<DraftLine>) =>
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );

  const readOf = (line: DraftLine) =>
    readLine(line, productById.get(line.productId)?.units ?? []);

  const lineIsComplete = (line: DraftLine) => {
    const read = readOf(line);
    const product = productById.get(line.productId);
    return (
      Boolean(product) &&
      (product!.variants.length === 0 || Boolean(line.variantId)) &&
      read !== null &&
      !read.error &&
      read.received > 0 &&
      line.totalCost !== null
    );
  };

  const complete = lines.filter(lineIsComplete);
  const goodsTotal = complete.reduce(
    (sum, line) => sum + (line.totalCost ?? 0),
    0,
  );
  const ready =
    Boolean(supplierId) &&
    complete.length > 0 &&
    (!settlesDeliveries || feeReady(fee));

  const record = useMutation({
    mutationFn: () =>
      api.post<GoodsReceiptView>('/goods-receipts', {
        id: receiptId,
        supplierId,
        ...(locationId ? { locationId } : {}),
        ...(invoiceNumber.trim()
          ? { invoiceNumber: invoiceNumber.trim() }
          : {}),
        ...(receivedAt
          ? { receivedAt: new Date(receivedAt).toISOString() }
          : {}),
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
        ...(settlesDeliveries && fee.amount
          ? { deliveryFee: feeBody(fee) }
          : {}),
        lines: complete.map((line) => {
          const read = readOf(line)!;
          return {
            id: line.key,
            productId: line.productId,
            ...(line.variantId ? { variantId: line.variantId } : {}),
            ...(read.unitId ? { unitId: read.unitId } : {}),
            quantityReceived: read.received,
            ...(read.paidFor !== undefined
              ? { quantityPaidFor: read.paidFor }
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
      if (draftKey) clearDraft(draftKey);
      afterWrite(queryClient);
      navigate(`/stock/receipts/${receipt.id}`);
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not record that delivery.',
      ),
  });

  useKeepDraft<DeliveryDraft>(
    draftKey,
    {
      receiptId,
      supplierId,
      locationId,
      invoiceNumber,
      receivedAt,
      note,
      lines,
      amountDue,
      paying,
      paidAmount,
      method,
      bankAccountId,
      reference,
      fee,
    },
    !record.isSuccess &&
      (Boolean(supplierId) ||
        Boolean(invoiceNumber.trim()) ||
        lines.some((line) => line.productId)),
  );

  /** Leaving on purpose throws the kept copy away; a failed save does not. */
  const cancel = () => {
    if (draftKey) clearDraft(draftKey);
    navigate('/stock/receipts');
  };

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
        <Button variant="secondary" onClick={cancel}>
          Cancel
        </Button>
      }
    >
      <form onSubmit={submit} className="space-y-6">
        {draft.noticeOpen && draft.restored && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
            <span>
              The delivery you were entering at {keptAt(draft.restored.savedAt)}{' '}
              was not saved, so it has been brought back. Check it and press
              Record again.
            </span>
            <Button type="button" variant="secondary" onClick={draft.dismiss}>
              OK
            </Button>
          </div>
        )}
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
              Add a product
            </Button>
          </div>

          <div className="divide-y divide-slate-100">
            {lines.map((line, index) => {
              const product = productById.get(line.productId);
              const units = product?.units ?? [];
              const read = readLine(line, units);
              const free = read && !read.error ? read.freeBase : 0;

              return (
                <div key={line.key} className="p-4">
                  <div className="grid gap-3 sm:grid-cols-12">
                    <div className="sm:col-span-4">
                      <Field label="Product" htmlFor={`line-product-${index}`}>
                        <Select
                          id={`line-product-${index}`}
                          value={choiceValue(line.productId, line.variantId)}
                          onChange={(event) => {
                            const choice = choices.find(
                              (row) => row.value === event.target.value,
                            );
                            const productId = choice?.product.id ?? '';
                            setLine(line.key, {
                              productId,
                              variantId: choice?.variantId ?? null,
                              // Another option of the same product keeps
                              // the unit chosen.
                              ...(productId !== line.productId && {
                                unitId: '',
                              }),
                            });
                          }}
                        >
                          <option value="">Choose a product</option>
                          {choices.map((choice) => (
                            <option key={choice.value} value={choice.value}>
                              {choice.label}
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
                        error={read?.error}
                      >
                        <Input
                          id={`line-received-${index}`}
                          inputMode="decimal"
                          value={line.quantityReceived}
                          onChange={(event) =>
                            setLine(line.key, {
                              quantityReceived: decimalDraft(
                                event.target.value,
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
                        hint={
                          free > 0 && read
                            ? `${free} ${read.baseName} free`
                            : undefined
                        }
                      >
                        <Input
                          id={`line-paid-${index}`}
                          inputMode="decimal"
                          value={line.quantityPaidFor}
                          onChange={(event) =>
                            setLine(line.key, {
                              quantityPaidFor: decimalDraft(event.target.value),
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
              This delivery raises a bill on <strong>Money → Bills</strong>{' '}
              whether or not anything was paid. It defaults to the goods total;
              override it when the vendor’s invoice carries a settlement
              discount or a charge that no stock line can hold — that does not
              change what the goods cost. A driver paid to bring the goods goes
              under <strong>Bringing it here</strong> below.
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

        {settlesDeliveries && (
          <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-900">
              Bringing it here
            </h2>
            <p className="text-xs text-slate-500">
              A delivery fee is part of what the goods cost. It is shared across
              the lines by value and added to what each item cost, so profit and
              stock value include it. It is not on the vendor’s bill and not an
              expense. Each item’s cost with delivery shows on the delivery’s
              page once it is recorded.
            </p>
            <DeliveryFeeFields
              fee={fee}
              onChange={setFee}
              idPrefix="receive-fee"
              recorderLabel="Me"
            />
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
            onClick={cancel}
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
