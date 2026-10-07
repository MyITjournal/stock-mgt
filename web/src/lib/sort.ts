import { useState } from 'react';

/**
 * Sorting a list by tapping a column heading (2026-10-07, owner: "easy for
 * laymen", and without having to narrow a list down to a category first).
 *
 * The first tap sorts low-to-high (A to Z, smallest first), the second reverses
 * it, the third puts the list back in the order the screen gave it. Rows with
 * nothing in that column — no price, no cost — always go last either way, so
 * sorting by price never opens on a page of blanks.
 *
 * **Only for lists that are all on screen.** A list that loads a page at a
 * time (sales, payments, deliveries) would sort just the page and mislead;
 * those get a newest/oldest switch on the server instead.
 */
export type SortValue = string | number | null | undefined;
export type SortDirection = 'asc' | 'desc';

export interface SortState {
  key: string;
  direction: SortDirection;
}

const text = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export function sortRows<Row>(
  rows: readonly Row[],
  valueOf: ((row: Row) => SortValue) | undefined,
  direction: SortDirection,
): Row[] {
  if (!valueOf) return [...rows];
  const sign = direction === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: valueOf(row) }))
    .sort((a, b) => {
      const aEmpty =
        a.value === null || a.value === undefined || a.value === '';
      const bEmpty =
        b.value === null || b.value === undefined || b.value === '';
      if (aEmpty || bEmpty) {
        // Blanks last in both directions; ties keep the screen's order.
        return aEmpty === bEmpty ? a.index - b.index : aEmpty ? 1 : -1;
      }
      const compared =
        typeof a.value === 'number' && typeof b.value === 'number'
          ? a.value - b.value
          : text.compare(String(a.value), String(b.value));
      return compared * sign || a.index - b.index;
    })
    .map((entry) => entry.row);
}

/** Which column is sorted and which way, with the three-tap cycle. */
export function useSort(initial: SortState | null = null) {
  const [sort, setSort] = useState<SortState | null>(initial);
  const toggle = (key: string) =>
    setSort((current) =>
      current?.key !== key
        ? { key, direction: 'asc' }
        : current.direction === 'asc'
          ? { key, direction: 'desc' }
          : null,
    );
  return { sort, toggle };
}
