/**
 * Finds the table inside a worksheet. Spreadsheets often have a title or
 * notes above the header row, and empty spacer columns; a profiler that
 * treated the title as the header would get every column wrong.
 */

export interface SheetTable {
  header: string[];
  rows: string[][];
  /** Rows with content above the header (titles, notes) that were left out. */
  rowsAboveHeader: number;
  /** Position of the header among the non-empty rows (0-based). */
  headerIndex: number;
  /** Columns with no header and no values that were left out. */
  emptyColumns: number;
}

const filledCount = (row: string[]) => row.reduce((n, cell) => n + (cell.trim() === '' ? 0 : 1), 0);

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/**
 * The header is the first row that is at least half as full as a typical
 * row. A title ("Sales extract") fills one cell where the table fills many,
 * so it is skipped; in a one-column sheet the first row is the header.
 */
export function findHeaderIndex(rows: string[][]): number {
  const typical = median(rows.slice(0, 500).map(filledCount));
  const needed = Math.max(1, Math.ceil(typical / 2));
  const index = rows.findIndex((row) => filledCount(row) >= needed);
  return Math.max(index, 0);
}

export function tableFromGrid(grid: string[][]): SheetTable {
  const rows = grid.filter((row) => filledCount(row) > 0);
  if (rows.length === 0) return { header: [], rows: [], rowsAboveHeader: 0, headerIndex: 0, emptyColumns: 0 };

  const headerIndex = findHeaderIndex(rows);
  const table = rows.slice(headerIndex);
  // One pass over the rows: a sheet can hold a million of them, too many to spread into Math.max.
  let width = 0;
  for (const row of table) if (row.length > width) width = row.length;
  const hasValue = new Array<boolean>(width).fill(false);
  for (const row of table) {
    for (let c = 0; c < row.length; c += 1) if (!hasValue[c] && row[c].trim() !== '') hasValue[c] = true;
  }
  const used = hasValue.flatMap((value, c) => (value ? [c] : []));

  const pick = (row: string[]) => used.map((c) => row[c] ?? '');
  return {
    header: pick(table[0]).map((name) => name.trim()),
    rows: table.slice(1).map(pick),
    rowsAboveHeader: headerIndex,
    headerIndex,
    emptyColumns: width - used.length,
  };
}
