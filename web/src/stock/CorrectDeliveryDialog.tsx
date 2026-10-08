import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DialogClose } from '../components/DialogClose';
import { Button } from '../components/Button';
import { Field, Input, MoneyInput, Select } from '../components/Field';
import { Money } from '../components/Money';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import type { components } from '../api/schema';
import { useProductUnits } from './units';
import { decimalDraft, toWholeBaseUnits } from '../lib/decimalQuantity';
import {
  choiceValue,
  optionLabel,
  stockChoices,
  type StockChoice,
} from '../lib/options';

type GoodsReceiptView = components['schemas']['GoodsReceiptView'];
type GoodsReceiptLineView = components['schemas']['GoodsReceiptLineView'];
type CorrectionPreviewView = components['schemas']['CorrectionPreviewView'];
type ProductView = components['schemas']['ProductView'];

interface UnitChoice {
  id: string;
  name: string;
  factor: number;
}

interface LineDraft {
  /**
   * The product that really came, when the line was entered as the wrong one
   * (2026-10-07), or the same product's right option (2026-10-08). Null while
   * what was recorded is right.
   */
  rightProduct: {
    id: string;
    variantId: string | null;
    name: string;
    units: UnitChoice[];
  } | null;
  received: string;
  receivedUnit: UnitChoice;
  paidFor: string;
  paidForUnit: UnitChoice;
  value: number | null;
  baseName: string;
}

/**
 * Putting a recorded delivery right — 7 cartons entered when 6½ arrived.
 *
 * Each line takes its **true** figures: received and paid for in any of the
 * product's units, **decimals allowed** where they come to whole pieces (6.5
 * cartons of 14 is 91; ½ of a carton of 15 is refused), and the invoice value.
 * Nothing is typed as a difference — the paperwork says what is true.
 *
 * **Check before save, and the check is the server's.** It runs the real
 * correction and rolls it back, so the stock change, the value change and
 * the bill before and after are the server's own figures — the browser works
 * out no money — and a refusal (fewer arrived than have already been sold, a
 * bill already paid past the new amount) shows up here rather than on save.
 * Changing anything clears the check.
 *
 * **Wrong product** (2026-10-07): a line entered as the roll-on when the
 * lotion came. One link per line swaps the name for a box to find the right
 * product; its units replace the line's, and the figures stay as typed. The
 * check then says what comes out of stock and what goes in. Nothing else on
 * the form changes — this is a correction, not a second way to receive.
 *
 * **Wrong option** (2026-10-08): the same box lists every option — Gold
 * entered when Moringa came is chosen like a product. Another option of the
 * same product keeps the line's units, and the server moves the stock between
 * options on the same lot, its cost untouched.
 */
export function CorrectDeliveryDialog({
  receipt,
  onClose,
}: {
  receipt: GoodsReceiptView;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>(() =>
    Object.fromEntries(
      receipt.lines.map((line) => {
        const unit = {
          id: line.unit.id,
          name: line.unit.name,
          factor: line.unitFactor,
        };
        return [
          line.id,
          {
            rightProduct: null,
            received: String(line.quantityReceivedInUnit),
            receivedUnit: unit,
            paidFor: String(line.quantityPaidForInUnit),
            paidForUnit: unit,
            value: line.totalCost ?? null,
            baseName: line.unitFactor === 1 ? line.unit.name : 'pieces',
          },
        ];
      }),
    ),
  );
  const [reason, setReason] = useState('');
  const [forcedReason, setForcedReason] = useState('');
  const [preview, setPreview] = useState<CorrectionPreviewView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsOverride, setNeedsOverride] = useState(false);

  const change = (lineId: string, next: Partial<LineDraft>) => {
    setDrafts((current) => ({
      ...current,
      [lineId]: { ...current[lineId], ...next },
    }));
    setPreview(null);
  };

  // Each line in base units, or the reason it cannot be.
  const read = receipt.lines.map((line) => {
    const draft = drafts[line.id];
    const received = toWholeBaseUnits(
      draft.received,
      draft.receivedUnit.factor,
      draft.receivedUnit.name,
      draft.baseName,
    );
    const paidFor = toWholeBaseUnits(
      draft.paidFor,
      draft.paidForUnit.factor,
      draft.paidForUnit.name,
      draft.baseName,
    );
    return { line, draft, received, paidFor };
  });
  const problems = read.flatMap(({ line, received, paidFor, draft }) => [
    ...('error' in received
      ? [`${recordedName(line)}: ${received.error}`]
      : []),
    ...('error' in paidFor ? [`${recordedName(line)}: ${paidFor.error}`] : []),
    ...(draft.value === null
      ? [`${recordedName(line)}: enter the value.`]
      : []),
  ]);

  const body = () => ({
    reason: reason.trim(),
    lines: read.map(({ line, received, paidFor, draft }) => ({
      lineId: line.id,
      // Another product names the product, and its option if it has them;
      // another option of the same product names only the option.
      ...(draft.rightProduct &&
        draft.rightProduct.id !== line.product.id && {
          productId: draft.rightProduct.id,
        }),
      ...(draft.rightProduct?.variantId && {
        variantId: draft.rightProduct.variantId,
      }),
      received: 'base' in received ? received.base : 0,
      paidFor: 'base' in paidFor ? paidFor.base : 0,
      totalCost: draft.value ?? 0,
    })),
    ...(needsOverride &&
      forcedReason.trim() && {
        force: true,
        forcedReason: forcedReason.trim(),
      }),
  });

  const failed = (caught: unknown) => {
    const message =
      caught instanceof ApiError ? caught.message : 'Could not do that.';
    setError(message);
    // Fewer arrived than have already been sold: an owner or manager can
    // record it anyway, with a reason — the same override as everywhere.
    if (message.startsWith('Not enough stock')) setNeedsOverride(true);
  };

  const check = useMutation({
    mutationFn: () =>
      api.post<CorrectionPreviewView>(
        `/goods-receipts/${receipt.id}/corrections/preview`,
        body(),
      ),
    onSuccess: (result) => {
      setError(null);
      setPreview(result);
    },
    onError: failed,
  });

  const save = useMutation({
    mutationFn: () =>
      api.post<GoodsReceiptView>(
        `/goods-receipts/${receipt.id}/corrections`,
        body(),
      ),
    onSuccess: () => {
      afterWrite(queryClient);
      onClose();
    },
    onError: failed,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (problems.length > 0 || reason.trim().length < 3) return;
    if (preview) save.mutate();
    else check.mutate();
  };

  const busy = check.isPending || save.isPending;
  const nameOf = (lineId: string) => {
    const line = receipt.lines.find((candidate) => candidate.id === lineId);
    return line ? recordedName(line) : '';
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="correct-title"
    >
      <form
        onSubmit={submit}
        className="relative my-8 w-full max-w-3xl rounded-xl border border-slate-200 bg-white p-6 shadow-lg"
      >
        <DialogClose onClose={onClose} />
        <h2 id="correct-title" className="text-lg font-semibold text-slate-900">
          Correct this delivery
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Enter what is true for each line. Stock, the delivery’s value and its
          bill move by the difference, and what was recorded before is kept.
          Decimals are fine where they come to whole pieces — 6.5 cartons.
        </p>

        <div className="mt-4 space-y-4">
          {receipt.lines.map((line) => (
            <LineRow
              key={line.id}
              line={line}
              draft={drafts[line.id]}
              onChange={(next) => change(line.id, next)}
            />
          ))}

          <Field label="What was wrong" htmlFor="correct-reason">
            <Input
              id="correct-reason"
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setPreview(null);
              }}
              placeholder="Miscounted: 6½ cartons came, not 7."
              required
            />
          </Field>

          {needsOverride && (
            <Field
              label="Record it anyway, because…"
              htmlFor="correct-force"
              hint="Some of those goods have already been sold. Say why the correction should still stand."
            >
              <Input
                id="correct-force"
                value={forcedReason}
                onChange={(event) => {
                  setForcedReason(event.target.value);
                  setPreview(null);
                }}
              />
            </Field>
          )}
        </div>

        {problems.length > 0 && (
          <ul className="mt-3 space-y-0.5 text-sm text-red-700">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}

        {preview && (
          <div className="mt-4 rounded-md bg-slate-50 p-3 text-sm">
            <div className="font-medium text-slate-900">If you save:</div>
            <ul className="mt-1 space-y-0.5 text-slate-700">
              {preview.lines.map((row) =>
                row.addedProductName ? (
                  <li key={row.lineId}>
                    {row.removedProductName}: −{row.removed}{' '}
                    {drafts[row.lineId].baseName} out of stock ·{' '}
                    {row.addedProductName}: +{row.stockDelta}{' '}
                    {drafts[row.lineId].baseName} into stock
                  </li>
                ) : (
                  <li key={row.lineId}>
                    {nameOf(row.lineId)}:{' '}
                    {row.stockDelta === 0
                      ? 'stock unchanged'
                      : `${row.stockDelta > 0 ? '+' : '−'}${Math.abs(row.stockDelta)} ${drafts[row.lineId].baseName} ${row.stockDelta > 0 ? 'into' : 'out of'} stock`}
                  </li>
                ),
              )}
              <li>
                Delivery value changes by{' '}
                <Money value={preview.valueDelta} signed />
              </li>
              {preview.billAmountBefore !== null &&
                preview.billAmountAfter !== null && (
                  <li>
                    Bill: <Money value={preview.billAmountBefore} /> →{' '}
                    <Money value={preview.billAmountAfter} />
                  </li>
                )}
            </ul>
          </div>
        )}

        {error && (
          <p
            className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700"
            role="alert"
          >
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={busy || problems.length > 0 || reason.trim().length < 3}
          >
            {busy ? 'Working…' : preview ? 'Save correction' : 'Check'}
          </Button>
        </div>
      </form>
    </div>
  );
}

/** One line: its recorded figures, and boxes for the true ones. */
function LineRow({
  line,
  draft,
  onChange,
}: {
  line: GoodsReceiptLineView;
  draft: LineDraft;
  onChange: (next: Partial<LineDraft>) => void;
}) {
  const { units, baseUnit } = useProductUnits(line.product.id);
  const [swapping, setSwapping] = useState(false);
  const recordedChoices: UnitChoice[] =
    units.length > 0
      ? units.map((unit) => ({
          id: unit.id,
          name: unit.name,
          factor: unit.factor,
        }))
      : [draft.receivedUnit];
  // Another option of the same product counts in the same units.
  const choices =
    draft.rightProduct && draft.rightProduct.id !== line.product.id
      ? draft.rightProduct.units
      : recordedChoices;
  const baseName =
    (draft.rightProduct && draft.rightProduct.id !== line.product.id
      ? choices.find((unit) => unit.factor === 1)?.name
      : baseUnit?.name) ?? draft.baseName;
  const pick = (id: string) => choices.find((unit) => unit.id === id)!;

  // The catalog, once, for the product box — the delivery form's own list.
  const { data: products = [] } = useQuery({
    queryKey: ['products', ''],
    queryFn: () => api.get<ProductView[]>('/products'),
    enabled: swapping,
  });
  const labelOf = (choice: StockChoice<ProductView>) =>
    optionLabel(
      choice.product.size
        ? `${choice.product.name} ${choice.product.size}`
        : choice.product.name,
      choice.optionName,
    );
  // Everything but what the line already is: other products, and the other
  // options of this one.
  const recorded = choiceValue(line.product.id, line.variant?.id);
  const candidates = stockChoices(
    products.filter((row) => row.trackStock),
  ).filter((choice) => choice.value !== recorded);

  /**
   * The right product or option chosen. Another product's units replace the
   * line's; another option of this product keeps them. The figures stay.
   */
  const chooseProduct = (label: string) => {
    const choice = candidates.find((row) => labelOf(row) === label);
    if (!choice) return;
    const product = choice.product;
    if (product.id === line.product.id) {
      onChange({
        rightProduct: {
          id: product.id,
          variantId: choice.variantId,
          name: labelOf(choice),
          units: recordedChoices,
        },
      });
      setSwapping(false);
      return;
    }
    const productUnits = product.units.map((unit) => ({
      id: unit.id,
      name: unit.name,
      factor: unit.factor,
    }));
    // Keep the unit by name when the right product has one — "piece" stays
    // "piece" — or else count in its base unit.
    const same = (name: string) =>
      productUnits.find((unit) => unit.name === name) ??
      productUnits.find((unit) => unit.factor === 1) ??
      productUnits[0];
    onChange({
      rightProduct: {
        id: product.id,
        variantId: choice.variantId,
        name: labelOf(choice),
        units: productUnits,
      },
      receivedUnit: same(draft.receivedUnit.name),
      paidForUnit: same(draft.paidForUnit.name),
      baseName:
        productUnits.find((unit) => unit.factor === 1)?.name ?? 'pieces',
    });
    setSwapping(false);
  };

  /** Back to the product the line was recorded as. */
  const keepRecorded = () => {
    const unit = {
      id: line.unit.id,
      name: line.unit.name,
      factor: line.unitFactor,
    };
    onChange({
      rightProduct: null,
      receivedUnit: unit,
      paidForUnit: unit,
      baseName: baseUnit?.name ?? draft.baseName,
    });
    setSwapping(false);
  };

  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span>
          {draft.rightProduct ? (
            <>
              <span className="text-slate-400 line-through">
                {recordedName(line)}
              </span>{' '}
              <span className="font-medium text-slate-900">
                {draft.rightProduct.name}
              </span>{' '}
              <button
                type="button"
                onClick={keepRecorded}
                className="text-xs text-slate-500 underline-offset-2 hover:underline"
              >
                undo
              </button>
            </>
          ) : (
            <>
              <span className="font-medium text-slate-900">
                {recordedName(line)}
              </span>{' '}
              {!swapping && (
                <button
                  type="button"
                  onClick={() => setSwapping(true)}
                  className="text-xs text-brand-700 underline-offset-2 hover:underline"
                >
                  {line.variant ? 'Wrong product or option?' : 'Wrong product?'}
                </button>
              )}
            </>
          )}
        </span>
        <span className="text-xs text-slate-500">
          Recorded: {line.quantityReceivedInUnit} {line.unit.name} received,{' '}
          {line.quantityPaidForInUnit} paid for
          {line.totalCost !== undefined && (
            <>
              , <Money value={line.totalCost} />
            </>
          )}
        </span>
      </div>
      {swapping && (
        <div className="mt-2">
          <Field
            label={
              line.variant
                ? 'The product or option that actually came'
                : 'The product that actually came'
            }
            htmlFor={`right-${line.id}`}
            hint="Start typing its name. What was recorded comes back out of stock; this goes in, at the line's cost."
          >
            <Input
              id={`right-${line.id}`}
              list={`right-products-${line.id}`}
              autoFocus
              placeholder={products.length === 0 ? 'Loading…' : 'Name and size'}
              onChange={(event) => chooseProduct(event.target.value)}
            />
            <datalist id={`right-products-${line.id}`}>
              {candidates.map((choice) => (
                <option key={choice.value} value={labelOf(choice)} />
              ))}
            </datalist>
          </Field>
          <button
            type="button"
            onClick={() => setSwapping(false)}
            className="mt-1 text-xs text-slate-500 underline-offset-2 hover:underline"
          >
            {line.variant
              ? 'Cancel — it is right'
              : 'Cancel — the product is right'}
          </button>
        </div>
      )}
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        <Field label="Actually received" htmlFor={`recv-${line.id}`}>
          <div className="flex gap-2">
            <Input
              id={`recv-${line.id}`}
              inputMode="decimal"
              className="w-20"
              value={draft.received}
              onChange={(event) =>
                onChange({
                  received: decimalDraft(event.target.value),
                  baseName,
                })
              }
            />
            <div className="min-w-0 flex-1">
              <Select
                aria-label="Unit received"
                value={draft.receivedUnit.id}
                onChange={(event) =>
                  onChange({ receivedUnit: pick(event.target.value), baseName })
                }
              >
                {choices.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </Field>
        <Field label="Paid for" htmlFor={`paid-${line.id}`}>
          <div className="flex gap-2">
            <Input
              id={`paid-${line.id}`}
              inputMode="decimal"
              className="w-20"
              value={draft.paidFor}
              onChange={(event) =>
                onChange({
                  paidFor: decimalDraft(event.target.value),
                  baseName,
                })
              }
            />
            <div className="min-w-0 flex-1">
              <Select
                aria-label="Unit paid for"
                value={draft.paidForUnit.id}
                onChange={(event) =>
                  onChange({ paidForUnit: pick(event.target.value), baseName })
                }
              >
                {choices.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </Field>
        <Field
          label="Invoice value of the line"
          htmlFor={`value-${line.id}`}
          hint="What the vendor's invoice really says."
        >
          <MoneyInput
            id={`value-${line.id}`}
            value={draft.value}
            onChange={(value) => onChange({ value, baseName })}
          />
        </Field>
      </div>
    </div>
  );
}

/** The line as recorded: "Eva Soap — Gold", or just the product. */
function recordedName(line: GoodsReceiptLineView): string {
  return optionLabel(line.product.name, line.variant?.name);
}
