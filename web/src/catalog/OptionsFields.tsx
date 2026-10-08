import { Button } from '../components/Button';
import { Input } from '../components/Field';

/** One option as the form holds it. `id` is minted here for a new one. */
export interface OptionDraft {
  id: string;
  /** One per attribute, in order — ["Gold"], or ["Chicken", "70g"]. */
  values: string[];
  isActive: boolean;
  /** Saved already: never removed, only retired. */
  existing: boolean;
}

/** At most two things options differ by — the API's MAX_VARIANT_ATTRIBUTES. */
const MAX_ATTRIBUTES = 2;

/**
 * A product's options (DECISIONS.md §24): Eva soap in Classic, Gold and
 * Moringa — one product, one price and one set of units, with each option
 * sold and counted on its own.
 *
 * Saved like units: an option is **never removed**, because sales and stock
 * point at it — it is retired instead, and can be restored. An option added in
 * this sitting can still be taken off with ×. What the options differ by can
 * be renamed at any time and a second can be added, but one that saved options
 * fill in cannot be taken away.
 */
export function OptionsFields({
  attributes,
  savedAttributes,
  options,
  onAttributesChange,
  onOptionsChange,
}: {
  attributes: string[];
  /** How many of `attributes` were saved already — those cannot be removed. */
  savedAttributes: number;
  options: OptionDraft[];
  onAttributesChange: (next: string[]) => void;
  onOptionsChange: (next: OptionDraft[]) => void;
}) {
  const hasOptions = attributes.length > 0;

  const setAttribute = (index: number, value: string) =>
    onAttributesChange(
      attributes.map((current, i) => (i === index ? value : current)),
    );

  const addAttribute = () => {
    onAttributesChange([...attributes, '']);
    onOptionsChange(
      options.map((option) => ({ ...option, values: [...option.values, ''] })),
    );
  };

  // Taking away the only one is "no options after all": the unsaved option
  // rows go with it, since there is nothing left for them to fill in.
  const removeAttribute = (index: number) => {
    if (attributes.length === 1) {
      onAttributesChange([]);
      onOptionsChange([]);
      return;
    }
    onAttributesChange(attributes.filter((_, i) => i !== index));
    onOptionsChange(
      options.map((option) => ({
        ...option,
        values: option.values.filter((_, i) => i !== index),
      })),
    );
  };

  const setValue = (id: string, index: number, value: string) =>
    onOptionsChange(
      options.map((option) =>
        option.id === id
          ? {
              ...option,
              values: option.values.map((current, i) =>
                i === index ? value : current,
              ),
            }
          : option,
      ),
    );

  const addOption = () =>
    onOptionsChange([
      ...options,
      {
        id: crypto.randomUUID(),
        values: attributes.map(() => ''),
        isActive: true,
        existing: false,
      },
    ]);

  const setActive = (id: string, isActive: boolean) =>
    onOptionsChange(
      options.map((option) =>
        option.id === id ? { ...option, isActive } : option,
      ),
    );

  const removeOption = (id: string) =>
    onOptionsChange(options.filter((option) => option.id !== id));

  if (!hasOptions) {
    return (
      <section className="mt-6">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-900">Options</h3>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              onAttributesChange(['']);
              onOptionsChange([
                {
                  id: crypto.randomUUID(),
                  values: [''],
                  isActive: true,
                  existing: false,
                },
              ]);
            }}
          >
            Add options
          </Button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          For a product that comes in flavours, colours or scents at the same
          size and price — Eva soap in Classic, Gold and Moringa. Each option is
          sold and counted on its own.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-900">Options</h3>
        <Button type="button" variant="secondary" onClick={addOption}>
          Add option
        </Button>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Every option shares this product's units and prices, unless you give it
        a price of its own below. At the till each one is its own item. A saved
        option is never removed — retire it and it can no longer be sold, but
        what is left of it can still be counted.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        {attributes.map((attribute, index) => (
          <label key={index} className="flex-1">
            <span className="block text-xs font-medium text-slate-700">
              {index === 0 ? 'Options differ by' : 'And by'}
            </span>
            <div className="mt-1 flex items-center gap-2">
              <Input
                aria-label={`Option attribute ${index + 1}`}
                value={attribute}
                maxLength={40}
                onChange={(event) => setAttribute(index, event.target.value)}
                placeholder={index === 0 ? 'Flavour' : 'Pack size'}
                className="flex-1"
              />
              {/* Saved options fill a saved attribute, so only a new one goes. */}
              {index >= savedAttributes && (
                <button
                  type="button"
                  onClick={() => removeAttribute(index)}
                  aria-label={
                    index === 0
                      ? 'No options after all'
                      : `Remove ${attribute || 'this'}`
                  }
                  title="Remove — not saved yet"
                  className="w-7 shrink-0 rounded-md p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                >
                  <span aria-hidden="true">×</span>
                </button>
              )}
            </div>
          </label>
        ))}
        {attributes.length < MAX_ATTRIBUTES && (
          <Button type="button" variant="ghost" onClick={addAttribute}>
            Add a second
          </Button>
        )}
      </div>

      <div className="mt-3 space-y-2">
        {options.map((option, row) => (
          <div key={option.id} className="flex items-center gap-3">
            {attributes.map((attribute, index) => (
              <Input
                key={index}
                aria-label={`Option ${row + 1} ${attribute || `value ${index + 1}`}`}
                value={option.values[index] ?? ''}
                maxLength={40}
                onChange={(event) =>
                  setValue(option.id, index, event.target.value)
                }
                placeholder={index === 0 ? 'Gold' : '70g'}
                className={`flex-1 ${option.isActive ? '' : 'text-slate-400 line-through'}`}
              />
            ))}
            {option.existing ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setActive(option.id, !option.isActive)}
                className="w-20 shrink-0"
              >
                {option.isActive ? 'Retire' : 'Restore'}
              </Button>
            ) : (
              <button
                type="button"
                onClick={() => removeOption(option.id)}
                aria-label={`Remove option ${row + 1}`}
                title="Remove — this option has not been saved yet"
                className="w-20 shrink-0 rounded-md p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
              >
                <span aria-hidden="true">×</span>
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
