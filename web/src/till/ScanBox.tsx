import { useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react';
import { Input } from '../components/Field';

/**
 * The one input a till is driven from.
 *
 * **A barcode scanner is a keyboard.** A USB scanner types the digits and
 * presses Enter, which means the entire fast path costs nothing but keeping a
 * text box focused and listening for submit (DECISIONS.md §17). No device
 * integration, no drivers, no permissions prompt.
 *
 * **And a person is a slower keyboard.** What is typed is handed up as it is
 * typed, so the till can suggest products before Enter; arrow keys and Escape
 * are handed up too, to move through those suggestions. The text lives in the
 * till rather than here, because the till decides when it is cleared — a scan
 * that added an item clears it, a search with several answers keeps it so the
 * list stays on screen.
 *
 * Which is also why focus is stolen back so insistently. If the caret drifts
 * into a quantity field, the next scan types a barcode into it and the sale is
 * silently wrong — so anything that is not a form control hands focus back, and
 * every completed scan returns it here.
 */
export function ScanBox({
  value,
  onChange,
  onSubmit,
  onNavigate,
  busy,
  disabled,
  listId,
  activeId,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onNavigate: (key: 'ArrowDown' | 'ArrowUp' | 'Escape') => void;
  busy: boolean;
  disabled?: boolean;
  /** The suggestions list, for screen readers. */
  listId?: string;
  activeId?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!busy && !disabled) ref.current?.focus();
  }, [busy, disabled]);

  useEffect(() => {
    if (disabled) return;

    const returnFocus = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, select, textarea, button, a, [role="dialog"]')) {
        return;
      }
      ref.current?.focus();
    };

    document.addEventListener('click', returnFocus);
    return () => document.removeEventListener('click', returnFocus);
  }, [disabled]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (
      event.key === 'ArrowDown' ||
      event.key === 'ArrowUp' ||
      event.key === 'Escape'
    ) {
      event.preventDefault();
      onNavigate(event.key);
    }
  };

  return (
    <form onSubmit={submit}>
      <label htmlFor="scan" className="sr-only">
        Scan a barcode or search by name
      </label>
      <Input
        id="scan"
        ref={ref}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={keyDown}
        placeholder="Scan a barcode, or start typing a name"
        autoComplete="off"
        autoFocus
        disabled={disabled}
        role="combobox"
        aria-expanded={Boolean(listId)}
        aria-controls={listId}
        aria-activedescendant={activeId}
        aria-autocomplete="list"
        className="h-12 text-base"
      />
      <p className="mt-1 text-xs text-slate-500">
        {busy
          ? 'Looking that up…'
          : 'Suggestions appear as you type. A scanner types the code and presses Enter for you.'}
      </p>
    </form>
  );
}
