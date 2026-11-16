import type { ProfileResult } from '../profile/types';
import { rowDiffSql, rowExamplesSql, valueSetsSql, type ColumnPair } from './compareSql';
import type { RowDiff, TableComparison, ValueSetDiff } from './types';

type Row = Record<string, unknown>;
export type Query = (sql: string) => Promise<Row[]>;

interface Side {
  table: string;
  result: Pick<ProfileResult, 'columns' | 'profiledRows' | 'totalRows' | 'table'>;
}

/** Categories up to this many distinct values have their value lists compared. */
const MAX_CATEGORY_VALUES = 60;
const num = (value: unknown) => (typeof value === 'bigint' ? Number(value) : Number(value ?? 0));

/** Columns present in both files, by name. */
export function sharedColumns(current: Side['result'], earlier: Side['result']): ColumnPair[] {
  const before = new Map(earlier.columns.map((c) => [c.name, c.sqlName]));
  return current.columns.flatMap((c) =>
    before.has(c.name) ? [{ name: c.name, current: c.sqlName, earlier: before.get(c.name)! }] : [],
  );
}

/**
 * The column to match rows on: one that is filled and different on every
 * row in both files. The current file's own key is preferred.
 */
export function chooseKey(current: Side['result'], earlier: Side['result']): string | null {
  const isKey = (side: Side['result'], name: string) => {
    const column = side.columns.find((c) => c.name === name);
    return (
      column !== undefined &&
      side.profiledRows > 1 &&
      column.facts.filled === side.profiledRows &&
      column.facts.distinct === side.profiledRows
    );
  };
  const grain = current.table?.findings.find((f) => f.kind === 'grain' && f.columns.length === 1)?.columns[0];
  const candidates = [...(grain ? [grain] : []), ...current.columns.map((c) => c.name)];
  return candidates.find((name) => isKey(current, name) && isKey(earlier, name)) ?? null;
}

export async function compareTables(query: Query, current: Side, earlier: Side): Promise<TableComparison> {
  const shared = sharedColumns(current.result, earlier.result);
  const byName = new Map(shared.map((c) => [c.name, c]));

  // Value lists of categories.
  const categories = shared.filter((pair) => {
    const now = current.result.columns.find((c) => c.name === pair.name)!;
    const before = earlier.result.columns.find((c) => c.name === pair.name)!;
    const small = (c: typeof now) => c.facts.distinct >= 1 && c.facts.distinct <= MAX_CATEGORY_VALUES;
    return (now.decision.role === 'category' || before.decision.role === 'category') && small(now) && small(before);
  });
  const values: ValueSetDiff[] = [];
  const valuesSql = valueSetsSql(current.table, earlier.table, categories);
  if (valuesSql) {
    const found = new Map<string, ValueSetDiff>();
    for (const row of await query(valuesSql)) {
      const column = String(row.column_name);
      const entry = found.get(column) ?? { column, added: [], removed: [] };
      (row.is_new ? entry.added : entry.removed).push(String(row.v));
      found.set(column, entry);
    }
    values.push(...categories.flatMap((c) => (found.has(c.name) ? [found.get(c.name)!] : [])));
  }

  // Row by row, when there is a key to match on.
  const sampled = (side: Side['result']) => side.profiledRows < side.totalRows;
  if (sampled(current.result) || sampled(earlier.result)) {
    return {
      rows: null,
      noRowsReason: 'Rows are only matched when both files are profiled in full, not from a sample.',
      values,
    };
  }
  const keyName = chooseKey(current.result, earlier.result);
  if (!keyName) {
    return {
      rows: null,
      noRowsReason: 'Rows could not be matched: no column is filled in and different on every row in both files.',
      values,
    };
  }
  const key = byName.get(keyName)!;
  const others = shared.filter((c) => c.name !== keyName);
  const [counts] = await query(rowDiffSql(current.table, earlier.table, key, others));
  const rows: RowDiff = {
    key: keyName,
    added: num(counts.added),
    removed: num(counts.removed),
    kept: num(counts.kept),
    changed: num(counts.changed),
    byColumn: others
      .map((c, i) => ({ column: c.name, rows: num(counts[`c${i}`]) }))
      .filter((c) => c.rows > 0)
      .sort((a, b) => b.rows - a.rows),
    examples: { added: [], removed: [], changed: [] },
  };
  if (rows.added + rows.removed + rows.changed > 0) {
    for (const row of await query(rowExamplesSql(current.table, earlier.table, key, others))) {
      const k = String(row.k);
      if (row.kind === 'added') rows.examples.added.push(k);
      else if (row.kind === 'removed') rows.examples.removed.push(k);
      else rows.examples.changed.push({ key: k, columns: String(row.cols).split('\x1f').filter(Boolean) });
    }
  }
  return { rows, noRowsReason: null, values };
}
