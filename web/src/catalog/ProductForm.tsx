import { useState, type FormEvent } from 'react';
import { DialogClose } from '../components/DialogClose';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../components/Button';
import { Money } from '../components/Money';
import { Field, Input, MoneyInput, Select } from '../components/Field';
import { QuantityInput } from '../components/QuantityInput';
import { Barcodes } from './Barcodes';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import { useSeesCost } from '../auth/useAuth';
import type { components } from '../api/schema';
import { previewIsSellable } from '../lib/sellingUnits';
import { FRACTIONS, portionOf } from '../lib/portions';

type ProductView = components['schemas']['ProductView'];
type CategoryView = components['schemas']['CategoryView'];
type PackagingTypeView = components['schemas']['PackagingTypeView'];
type PriceTierView = components['schemas']['PriceTierView'];
type OrganizationView = components['schemas']['OrganizationView'];

/*
 * `key` is a React key and nothing else — it is never sent. Rows can be removed
 * from the middle of the list, and keyed by index the row below would inherit
 * the removed one's half-typed price.
 */
interface UnitDraft {
  key: string;
  name: string;
  factor: number;
  existing: boolean;
  isBase: boolean;
  /**
   * Null until somebody ticks or unticks it. An untouched box shows the
   * server's default for this kind of shop and sends nothing, so that default
   * is the one stored rather than the form's copy of it.
   */
  isSellable: boolean | null;
}

interface PriceDraft {
  key: string;
  unit: string;
  tierId: string;
  price: number | null;
  existing: boolean;
}

/**
 * Adding and editing a product — the one form where the server's write
 * semantics are unusual enough that the screen has to explain itself.
 *
 * **Units, prices and barcodes all upsert and never delete what they are not
 * sent** (DECISIONS.md §4). A PATCH naming one unit must not wipe the prices of
 * the rest, so the server leaves anything unlisted alone. The consequence for a
 * form is easy to get wrong: a list with remove buttons would *imply*
 * replace-all, and removing a row would silently do nothing at all.
 *
 * So nothing here offers to remove a *saved* unit or price, and the form says
 * why rather than leaving somebody to discover it. A row added in this sitting
 * and not yet saved is another matter: it exists only in the form, so its ×
 * really does remove it, and a mistyped "Add unit" no longer has to be saved
 * and lived with.
 *
 * - **Units cannot be deleted** because movements, sale lines and receipt lines
 *   point at them; removing one would orphan history that is meant to be
 *   immutable.
 * - **Prices cannot be deleted** because there is no endpoint for it, and that
 *   is deliberate: a unit with no tier price falls back to `basePrice ×
 *   factor`, which is right for a sachet and wrong for a carton — the silent
 *   overcharge the per-unit price list exists to prevent. Change a price rather
 *   than removing it.
 * - **The base price is optional, and empty means no fallback at all.** A unit
 *   with no price of its own then has no price, and the till will not sell it
 *   until it gets one — never a guess. That is what a distributor wants: it
 *   never sells the counted-in unit, so a price for it means nothing.
 * - **Barcodes can be added and deleted**, because they have endpoints of
 *   their own and detaching a code strands nothing. They are handled in
 *   `Barcodes` below, which writes immediately rather than on Save — that
 *   difference is why they are a section apart rather than more rows here.
 *   This comment claimed the deletion was possible long before there was a
 *   button for it, which is its own small lesson about documenting intent.
 *
 * The base unit also cannot move once set: stock is recorded in base units, so
 * changing which unit that is would reinterpret every quantity in the ledger.
 *
 * **The base unit is shown as "Counted in", not "base"**, because counting is
 * not selling. To a shop owner "base" means the smallest thing they sell; here
 * it means the smallest piece that can be left on a shelf. A distributor counts
 * Peak 14g in sachets — half a carton leaves half a roll behind — and never
 * sells one, which is what the "Sold" box on each unit is for. The kind of
 * shop (§22) decides how that box starts out.
 */
export function ProductForm({
  product,
  onClose,
}: {
  product: ProductView | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const seesCost = useSeesCost();
  const editing = product !== null;

  const [name, setName] = useState(product?.name ?? '');
  const [size, setSize] = useState(product?.size ?? '');
  const [sku, setSku] = useState(product?.sku ?? '');
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? '');
  const [packagingTypeId, setPackagingTypeId] = useState(
    product?.packagingTypeId ?? '',
  );
  const [basePrice, setBasePrice] = useState<number | null>(
    product?.basePrice ?? null,
  );
  const [taxRateBps, setTaxRateBps] = useState(product?.taxRateBps ?? 750);
  const [trackStock, setTrackStock] = useState(product?.trackStock ?? true);
  const [reorderPoint, setReorderPoint] = useState<string>(
    product?.reorderPoint === null || product?.reorderPoint === undefined
      ? ''
      : String(product.reorderPoint),
  );
  const [error, setError] = useState<string | null>(null);

  const [units, setUnits] = useState<UnitDraft[]>(
    product
      ? product.units.map((unit) => ({
          key: unit.id,
          name: unit.name,
          factor: unit.factor,
          existing: true,
          isBase: unit.isBase,
          isSellable: unit.isSellable,
        }))
      : [
          {
            key: crypto.randomUUID(),
            name: 'piece',
            factor: 1,
            existing: false,
            isBase: true,
            isSellable: null,
          },
        ],
  );

  // The unit the till picks first, by name. '' leaves it to the server —
  // the biggest sold unit for a wholesaler, the smallest for anyone else.
  const initialDefault =
    product?.units.find((unit) => unit.isDefaultSelling)?.name ?? '';
  const [defaultUnit, setDefaultUnit] = useState(initialDefault);

  // Every member may read the organization, so this works for any role that
  // can open the form. Until it arrives, mixed previews today's behaviour.
  const { data: organization } = useQuery({
    queryKey: ['organization'],
    queryFn: () => api.get<OrganizationView>('/organization'),
  });
  const businessType = organization?.businessType ?? 'mixed';

  const sold = (unit: UnitDraft) =>
    unit.isSellable ?? previewIsSellable(unit, units.length, businessType);
  const baseName = units.find((row) => row.isBase)?.name.trim() || 'base';
  const soldNames = units
    .filter((unit) => unit.name.trim() && sold(unit))
    .map((unit) => unit.name.trim());
  // A default that stopped being sold falls back to "automatic" rather than
  // being sent and refused.
  const effectiveDefault = soldNames.includes(defaultUnit) ? defaultUnit : '';

  const [prices, setPrices] = useState<PriceDraft[]>(
    product
      ? product.prices.map((price) => ({
          key: price.id,
          unit: price.unit.name,
          tierId: price.tierId,
          price: price.price,
          existing: true,
        }))
      : [],
  );

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<CategoryView[]>('/categories'),
  });
  const { data: packagingTypes = [] } = useQuery({
    queryKey: ['packaging-types'],
    queryFn: () => api.get<PackagingTypeView[]>('/packaging-types'),
  });
  const { data: tiers = [] } = useQuery({
    queryKey: ['price-tiers'],
    queryFn: () => api.get<PriceTierView[]>('/price-tiers'),
  });

  const save = useMutation({
    mutationFn: () => {
      // Only rows that were added or changed are sent. Sending everything would
      // work — the server upserts — but it would also rewrite prices nobody
      // touched, and make an audit of what changed impossible to read.
      const body = {
        name: name.trim(),
        // Always sent, even blank: on an edit, '' is how a size is cleared,
        // and leaving it out would mean "keep the old one".
        size: size.trim(),
        ...(sku.trim() && { sku: sku.trim() }),
        ...(categoryId && { categoryId }),
        ...(packagingTypeId && { packagingTypeId }),
        // On an edit the box is always sent, so emptying it clears the
        // fallback (null). A new product simply has none until one is typed.
        ...(editing ? { basePrice } : basePrice !== null && { basePrice }),
        taxRateBps,
        trackStock,
        ...(reorderPoint.trim() !== '' && {
          reorderPoint: Number(reorderPoint),
        }),
        units: units.map((unit) => ({
          name: unit.name,
          factor: unit.factor,
          // Only a box somebody touched is sent: an untouched one is the
          // server's default to decide, and for a saved unit, omitting it
          // leaves it as it is.
          ...(unit.isSellable !== null && { isSellable: unit.isSellable }),
          ...(effectiveDefault &&
            effectiveDefault !== initialDefault &&
            unit.name === effectiveDefault && { isDefaultSelling: true }),
        })),
        ...(prices.some((price) => price.price !== null) && {
          prices: prices
            .filter((price) => price.price !== null)
            .map((price) => ({
              unit: price.unit,
              tierId: price.tierId,
              price: price.price as number,
            })),
        }),
      };

      return editing
        ? api.patch<ProductView>(`/products/${product.id}`, body)
        : api.post<ProductView>('/products', {
            id: crypto.randomUUID(),
            ...body,
          });
    },
    onSuccess: () => {
      afterWrite(queryClient);
      onClose();
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not save that product.',
      ),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (name.trim() && units.length > 0) save.mutate();
  };

  // "Add a portion": which fraction of which unit. The unit is held by row
  // key, so renaming it after picking it does not lose the choice.
  const [portionFraction, setPortionFraction] = useState(0);
  const [portionUnitKey, setPortionUnitKey] = useState('');
  const [portionError, setPortionError] = useState<string | null>(null);
  // A portion of the counted-in unit is never whole — half of one sachet —
  // so only the bigger units are offered.
  const portionSources = units.filter(
    (unit) => !unit.isBase && unit.name.trim() && unit.factor > 1,
  );
  const portionSource =
    portionSources.find((unit) => unit.key === portionUnitKey) ??
    portionSources.at(-1);

  const addPortion = () => {
    if (!portionSource) return;
    const result = portionOf(
      portionSource,
      FRACTIONS[portionFraction],
      baseName,
      {
        // The counted-in unit can still be renamed while the product is new;
        // once saved it never changes, and the message has to say which.
        canChangeCountedIn: !units.some((unit) => unit.isBase && unit.existing),
        existingNames: units.map((unit) => unit.name),
      },
    );
    if (!result.ok) {
      setPortionError(result.reason);
      return;
    }
    setPortionError(null);
    setUnits((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        name: result.name,
        factor: result.factor,
        existing: false,
        isBase: false,
        isSellable: null,
      },
    ]);
  };

  const addUnit = () =>
    setUnits((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        name: '',
        factor: 1,
        existing: false,
        isBase: false,
        isSellable: null,
      },
    ]);

  // Unsaved prices on the unit go with it: they are keyed by unit name, and
  // left behind they would point at a unit the request no longer creates.
  const removeUnit = (key: string) => {
    const removed = units.find((unit) => unit.key === key);
    setUnits((current) => current.filter((unit) => unit.key !== key));
    if (removed) {
      setPrices((current) =>
        current.filter(
          (price) => price.existing || price.unit !== removed.name,
        ),
      );
    }
  };

  const removePrice = (key: string) =>
    setPrices((current) => current.filter((price) => price.key !== key));

  const addPrice = () =>
    setPrices((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        unit: units[0]?.name ?? '',
        tierId: tiers.find((tier) => tier.isDefault)?.id ?? tiers[0]?.id ?? '',
        price: null,
        existing: false,
      },
    ]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="product-title"
    >
      <form
        onSubmit={submit}
        className="relative my-8 w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-lg"
      >
        <DialogClose onClose={onClose} />

        <h2 id="product-title" className="text-lg font-semibold text-slate-900">
          {editing ? `Edit ${product.name}` : 'Add a product'}
        </h2>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="p-name">
            <Input
              id="p-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
              required
            />
          </Field>

          <Field
            label="Size"
            htmlFor="p-size"
            hint="Optional — 400g, 33cl, 1L. Shown beside the name."
          >
            <Input
              id="p-size"
              value={size}
              maxLength={40}
              onChange={(event) => setSize(event.target.value)}
              placeholder="400g"
            />
          </Field>

          <Field
            label="SKU"
            htmlFor="p-sku"
            hint={editing ? undefined : 'Left blank, one is generated.'}
          >
            <Input
              id="p-sku"
              value={sku}
              onChange={(event) => setSku(event.target.value)}
            />
          </Field>

          <Field label="Category" htmlFor="p-category">
            <Select
              id="p-category"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              <option value="">None</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Packaging" htmlFor="p-packaging">
            <Select
              id="p-packaging"
              value={packagingTypeId}
              onChange={(event) => setPackagingTypeId(event.target.value)}
            >
              <option value="">None</option>
              {packagingTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label={`Price per ${baseName} (optional)`}
            htmlFor="p-base-price"
            hint={
              basePrice === null
                ? `Empty: a unit with no price below cannot be sold until you give it one. Right if you never sell by the ${baseName}.`
                : `Tax-inclusive. A unit with no price below is charged this × its size.`
            }
          >
            <MoneyInput
              id="p-base-price"
              value={basePrice}
              onChange={setBasePrice}
            />
          </Field>

          {seesCost && (
            <div>
              <span className="block text-sm font-medium text-slate-700">
                Cost price
              </span>
              {/*
                Shown, not typed. Every goods receipt overwrites this with
                `totalCost / quantityReceived`, so anything entered here
                survives until the next delivery and then disappears — and it
                changes nothing in the meantime, because valuation and margins
                read the lot totals rather than this field (§2).

                A box that accepts a number, ignores it, and then forgets it is
                worse than no box: it invites somebody to "correct" a cost and
                believe they have.
              */}
              <p className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                {product?.costPrice === null ||
                product?.costPrice === undefined ? (
                  <span className="text-slate-400">
                    Nothing bought yet — record a delivery to set this.
                  </span>
                ) : (
                  <Money value={product.costPrice} />
                )}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                What one base unit last cost, taken from the most recent
                delivery. To change it, record the delivery — that is also what
                makes stock valuation and margins right.
              </p>
            </div>
          )}

          <Field label="VAT rate" htmlFor="p-tax">
            <Select
              id="p-tax"
              value={String(taxRateBps)}
              onChange={(event) => setTaxRateBps(Number(event.target.value))}
            >
              <option value="750">7.5%</option>
              <option value="0">Exempt</option>
            </Select>
          </Field>

          <Field
            label="Reorder point"
            htmlFor="p-reorder"
            hint="In base units. Blank for none."
          >
            {/*
              Digits filtered rather than `type="number"`, for the two reasons
              that field is a trap on a form: a scroll wheel over a focused
              number input silently changes it, and it happily accepts `2.5`
              against a column the server requires to be a whole number of base
              units. Blank stays possible — that is "no reorder point" — which
              is why this holds the typed string rather than a number.
            */}
            <Input
              id="p-reorder"
              inputMode="numeric"
              value={reorderPoint}
              onChange={(event) =>
                setReorderPoint(event.target.value.replace(/[^\d]/g, ''))
              }
            />
          </Field>
        </div>

        <label className="mt-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={trackStock}
            onChange={(event) => setTrackStock(event.target.checked)}
          />
          <span className="text-slate-700">
            Track stock for this product
            <span className="ml-1 text-xs text-slate-500">
              (off for a service, or anything sold without touching the ledger)
            </span>
          </span>
        </label>

        {/* -- Units ------------------------------------------------------- */}
        <section className="mt-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Units</h3>
            <Button type="button" variant="secondary" onClick={addUnit}>
              Add unit
            </Button>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            The unit with a factor of 1 is what stock is{' '}
            <strong>counted in</strong> — the smallest piece that can be left on
            your shelf. It does not have to be something you sell: untick{' '}
            <em>Sold</em> and the till never offers it. A unit added by mistake
            can be taken off with × until you save; after that it is{' '}
            <strong>never removed</strong>, because sales and movements point at
            it.
          </p>

          <div className="mt-3 space-y-2">
            {units.map((unit, index) => (
              <div key={unit.key} className="flex items-center gap-3">
                <Input
                  aria-label={`Unit ${index + 1} name`}
                  value={unit.name}
                  disabled={unit.existing}
                  onChange={(event) =>
                    setUnits((current) =>
                      current.map((row, i) =>
                        i === index ? { ...row, name: event.target.value } : row,
                      ),
                    )
                  }
                  placeholder="carton"
                  className="flex-1"
                />
                <QuantityInput
                  label={`Unit ${index + 1} factor`}
                  min={1}
                  value={unit.factor}
                  disabled={unit.isBase}
                  onChange={(next) =>
                    setUnits((current) =>
                      current.map((row, i) =>
                        i === index ? { ...row, factor: next } : row,
                      ),
                    )
                  }
                  className="w-28"
                />
                <span className="w-24 text-xs text-slate-500">
                  {unit.isBase
                    ? 'counted in'
                    : `= ${unit.factor} ${baseName}`}
                </span>
                <label
                  className="flex w-16 shrink-0 items-center gap-1.5 text-xs text-slate-600"
                  title="Offered at the till. Deliveries and counts use every unit regardless."
                >
                  <input
                    type="checkbox"
                    checked={sold(unit)}
                    onChange={(event) =>
                      setUnits((current) =>
                        current.map((row) =>
                          row.key === unit.key
                            ? { ...row, isSellable: event.target.checked }
                            : row,
                        ),
                      )
                    }
                    aria-label={`Sell ${unit.name || 'this unit'} at the till`}
                  />
                  Sold
                </label>
                {/* The base unit stays even unsaved: a product needs one. */}
                <RemoveRow
                  show={!unit.existing && !unit.isBase}
                  label={`Remove unit ${unit.name || index + 1}`}
                  onClick={() => removeUnit(unit.key)}
                />
              </div>
            ))}
          </div>

          {/*
            A portion is an ordinary unit with its own price — half a carton is
            rarely exactly half the carton price — so all this does is the
            arithmetic and the name. Nothing on the server knows it was made
            here.
          */}
          {portionSources.length > 0 && (
            <div className="mt-3 rounded-md border border-dashed border-slate-300 p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
                <span>Add a portion:</span>
                <Select
                  aria-label="Portion"
                  value={String(portionFraction)}
                  onChange={(event) => {
                    setPortionFraction(Number(event.target.value));
                    setPortionError(null);
                  }}
                  className="w-20"
                >
                  {FRACTIONS.map((fraction, index) => (
                    <option key={fraction.text} value={index}>
                      {fraction.label}
                    </option>
                  ))}
                </Select>
                <span>of a</span>
                <Select
                  aria-label="Portion of which unit"
                  value={portionSource?.key ?? ''}
                  onChange={(event) => {
                    setPortionUnitKey(event.target.value);
                    setPortionError(null);
                  }}
                  className="w-36"
                >
                  {portionSources.map((unit) => (
                    <option key={unit.key} value={unit.key}>
                      {unit.name}
                    </option>
                  ))}
                </Select>
                <Button type="button" variant="secondary" onClick={addPortion}>
                  Add
                </Button>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Works out how many {baseName}s it holds and adds it as a unit
                you can price on its own.
              </p>
              {portionError && (
                <p className="mt-2 text-xs text-red-700" role="alert">
                  {portionError}
                </p>
              )}
            </div>
          )}

          {soldNames.length === 0 ? (
            <p className="mt-3 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
              Tick <em>Sold</em> on at least one unit, or the till will have
              nothing to sell this product in.
            </p>
          ) : (
            <div className="mt-3 max-w-xs">
              <Field
                label="Till picks first"
                htmlFor="p-default-unit"
                hint="The unit a product goes into the cart in when it is picked from search."
              >
                <Select
                  id="p-default-unit"
                  value={effectiveDefault}
                  onChange={(event) => setDefaultUnit(event.target.value)}
                >
                  <option value="">
                    {businessType === 'wholesale'
                      ? 'Automatic — the biggest sold unit'
                      : 'Automatic — the smallest sold unit'}
                  </option>
                  {soldNames.map((unitName) => (
                    <option key={unitName} value={unitName}>
                      {unitName}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
        </section>

        {/* -- Prices ------------------------------------------------------ */}
        <section className="mt-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              Prices per unit
            </h3>
            <Button
              type="button"
              variant="secondary"
              onClick={addPrice}
              disabled={tiers.length === 0}
            >
              Add price
            </Button>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {basePrice === null
              ? 'A unit with no price here cannot be sold until it has one — the till will not guess.'
              : `A unit with no price here is charged the price per ${baseName} × its size, which is right for a sachet and usually wrong for a carton.`}{' '}
            A price added
            by mistake can be taken off with × until you save; after that it can
            be changed but <strong>not removed</strong> — set the right number
            instead of clearing it.
          </p>

          <div className="mt-3 space-y-2">
            {prices.length === 0 && (
              <p className="text-xs text-slate-400">
                {basePrice === null
                  ? 'No prices yet. Nothing can be sold until a unit has one.'
                  : `No prices yet. Every unit will be charged the price per ${baseName} × its size.`}
              </p>
            )}
            {prices.map((price, index) => (
              <div key={price.key} className="flex items-center gap-3">
                <Select
                  aria-label={`Price ${index + 1} unit`}
                  value={price.unit}
                  disabled={price.existing}
                  onChange={(event) =>
                    setPrices((current) =>
                      current.map((row, i) =>
                        i === index ? { ...row, unit: event.target.value } : row,
                      ),
                    )
                  }
                  className="flex-1"
                >
                  {units.map((unit) => (
                    <option key={unit.name} value={unit.name}>
                      {unit.name}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label={`Price ${index + 1} tier`}
                  value={price.tierId}
                  disabled={price.existing}
                  onChange={(event) =>
                    setPrices((current) =>
                      current.map((row, i) =>
                        i === index
                          ? { ...row, tierId: event.target.value }
                          : row,
                      ),
                    )
                  }
                  className="flex-1"
                >
                  {tiers.map((tier) => (
                    <option key={tier.id} value={tier.id}>
                      {tier.name}
                    </option>
                  ))}
                </Select>
                <MoneyInput
                  id={`price-${index}`}
                  aria-label={`Price ${index + 1} amount`}
                  value={price.price}
                  onChange={(value) =>
                    setPrices((current) =>
                      current.map((row, i) =>
                        i === index ? { ...row, price: value } : row,
                      ),
                    )
                  }
                  className="w-32 text-right"
                />
                <RemoveRow
                  show={!price.existing}
                  label={`Remove price ${index + 1}`}
                  onClick={() => removePrice(price.key)}
                />
              </div>
            ))}
          </div>
        </section>

        {editing && <Barcodes product={product} units={units} />}

        {editing && (
          <p className="mt-4 rounded-md bg-slate-50 p-3 text-xs text-slate-500">
            Anything not listed here is left exactly as it is. This form sends
            changes, not a replacement.
          </p>
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
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={save.isPending}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={
              save.isPending ||
              !name.trim() ||
              units.length === 0 ||
              soldNames.length === 0
            }
          >
            {save.isPending
              ? 'Saving…'
              : editing
                ? 'Save changes'
                : 'Add product'}
          </Button>
        </div>
      </form>
    </div>
  );
}

/**
 * The × on an unsaved row. Saved rows get an empty slot of the same width, so
 * the columns stay lined up whether a row can be removed or not.
 */
function RemoveRow({
  show,
  label,
  onClick,
}: {
  show: boolean;
  label: string;
  onClick: () => void;
}) {
  if (!show) return <span className="w-7 shrink-0" aria-hidden="true" />;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title="Remove — this row has not been saved yet"
      className="w-7 shrink-0 rounded-md p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-slate-200"
    >
      <span aria-hidden="true" className="block h-4 leading-4">
        ×
      </span>
    </button>
  );
}
