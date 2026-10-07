import type { ReactNode } from 'react';
import { sortRows, useSort, type SortValue } from '../lib/sort';
import { SortHeading } from './SortHeading';

export interface Column<Row> {
  /** Heading text. */
  header: string;
  /** What to draw in the cell. */
  cell: (row: Row) => ReactNode;
  /** Right-align, which is what every money and quantity column wants. */
  numeric?: boolean;
  className?: string;
  /**
   * Makes the heading tappable to sort by this. **Only on a table holding the
   * whole list** — see the note on `DataTable`.
   */
  sortValue?: (row: Row) => SortValue;
}

interface DataTableProps<Row> {
  rows: readonly Row[];
  columns: readonly Column<Row>[];
  /** Stable identity. Falls back to the index, which is fine for static lists. */
  rowKey?: (row: Row, index: number) => string;
  onRowClick?: (row: Row) => void;
  /** Shown instead of an empty table. Say what would put something here. */
  empty?: ReactNode;
  loading?: boolean;
}

/**
 * One table, repeated everywhere.
 *
 * Built in the foundation slice on purpose: roughly twenty screens are a list
 * of something, and the difference between deciding alignment, empty states and
 * row affordances once versus twenty times is most of the work in them.
 *
 * Paging and filtering belong to the endpoint behind the screen. **Sorting is
 * opt-in per column** (`sortValue`, 2026-10-07) and only for tables that hold
 * the whole list — a report, the margins. A table holding one page of a keyset
 * feed must not offer it: sorting the page it happens to have tells people
 * something untrue about the rest of the data.
 */
export function DataTable<Row>({
  rows,
  columns,
  rowKey,
  onRowClick,
  empty = 'Nothing here yet.',
  loading = false,
}: DataTableProps<Row>) {
  const { sort, toggle } = useSort();
  const sorting = sort
    ? columns.find((column) => column.header === sort.key)?.sortValue
    : undefined;
  const shown =
    sort && sorting ? sortRows(rows, sorting, sort.direction) : rows;

  if (loading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        Loading…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
        {empty}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            {columns.map((column) =>
              column.sortValue ? (
                <SortHeading
                  key={column.header}
                  label={column.header}
                  sortKey={column.header}
                  sort={sort}
                  onToggle={toggle}
                  numeric={column.numeric}
                  caps={false}
                  className="py-3 text-slate-600"
                />
              ) : (
                <th
                  key={column.header}
                  scope="col"
                  className={`px-4 py-3 font-medium text-slate-600 ${
                    column.numeric ? 'text-right' : 'text-left'
                  }`}
                >
                  {column.header}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {shown.map((row, index) => (
            <tr
              key={rowKey ? rowKey(row, index) : index}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={
                onRowClick
                  ? 'cursor-pointer transition hover:bg-slate-50'
                  : undefined
              }
            >
              {columns.map((column) => (
                <td
                  key={column.header}
                  className={`px-4 py-3 text-slate-700 ${
                    column.numeric ? 'text-right' : 'text-left'
                  } ${column.className ?? ''}`.trim()}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
