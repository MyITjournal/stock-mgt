import type { SortState } from '../lib/sort';

/**
 * A column heading you can tap to sort by (see `lib/sort.ts`).
 *
 * The arrow says which way the list is sorted; a faint double arrow on the
 * others says they can be tapped too, which is the whole of the instruction a
 * first-time user needs.
 */
export function SortHeading({
  label,
  sortKey,
  sort,
  onToggle,
  numeric = false,
  caps = true,
  className = '',
}: {
  label: string;
  sortKey: string;
  sort: SortState | null;
  onToggle: (key: string) => void;
  numeric?: boolean;
  /** Upper-case headings, as the hand-built lists have; `DataTable` does not. */
  caps?: boolean;
  className?: string;
}) {
  const active = sort?.key === sortKey;
  const arrow = !active ? '↕' : sort.direction === 'asc' ? '↑' : '↓';
  const said = !active
    ? `Sort by ${label}`
    : sort.direction === 'asc'
      ? `Sorted by ${label}, lowest first. Tap to reverse.`
      : `Sorted by ${label}, highest first. Tap to clear.`;

  return (
    <th
      className={`px-4 font-medium ${numeric ? 'text-right' : 'text-left'} ${className || 'py-2'}`}
      aria-sort={
        !active ? 'none' : sort.direction === 'asc' ? 'ascending' : 'descending'
      }
    >
      <button
        type="button"
        onClick={() => onToggle(sortKey)}
        title={said}
        className={`inline-flex items-center gap-1 ${caps ? 'uppercase tracking-wide' : ''} hover:text-slate-800 ${
          active ? 'text-slate-900' : ''
        }`}
      >
        {label}
        <span
          aria-hidden="true"
          className={active ? 'text-brand-600' : 'text-slate-300'}
        >
          {arrow}
        </span>
      </button>
    </th>
  );
}
