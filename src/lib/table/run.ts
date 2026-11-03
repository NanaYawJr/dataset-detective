import { planTableChecks } from './plan';
import { coverageSql, datePairsSql, dependenciesSql, keysSql } from './tableSql';
import type { CoverageResult, TableColumn, TableResults } from './types';

/** Runs the whole-table checks with any engine that can answer a query with rows. */

type Row = Record<string, unknown>;
export type Query = (sql: string) => Promise<Row[]>;

const num = (value: unknown): number => (typeof value === 'bigint' ? Number(value) : Number(value ?? 0));

/** DuckDB lists come back as Arrow vectors in the browser and arrays in tests. */
function strings(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === 'object' && Symbol.iterator in value) return [...(value as Iterable<unknown>)].map(String);
  return [];
}

export async function runTableChecks(
  query: Query,
  table: string,
  columns: TableColumn[],
  rows: number,
  today: number,
): Promise<TableResults> {
  const plan = planTableChecks(columns, rows);

  const [keys] = await query(keysSql(table, plan.keyPairs));
  const totalRows = num(keys.total_rows);
  const duplicateRows = totalRows - num(keys.distinct_rows);
  const singleKeys = columns
    .filter((c) => c.facts.filled === totalRows && c.facts.distinct === totalRows && totalRows > 1)
    .map((c) => c.name);
  const pairIndex = plan.keyPairs.findIndex((_, i) => num(keys[`pair_${i}`]) === totalRows);
  const pairKey =
    singleKeys.length === 0 && duplicateRows === 0 && pairIndex >= 0
      ? ([plan.keyPairs[pairIndex][0].label, plan.keyPairs[pairIndex][1].label] as [string, string])
      : null;

  const depSql = dependenciesSql(table, plan.dependencyPairs);
  // Row idx 2i is pair i read forwards, 2i+1 the same pair in reverse.
  const within = plan.dependencyPairs.flatMap(([a, b]) => {
    const w = a.within && a.within === b.within ? a.within : undefined;
    return [w, w];
  });
  const dependencies = depSql
    ? (await query(depSql)).map((r) => ({
        within: within[num(r.idx)],
        from: String(r.from_label),
        to: String(r.to_label),
        keys: num(r.keys),
        repeated: num(r.repeated),
        violating: num(r.violating),
        examples: strings(r.examples),
        toDistinct: num(r.to_distinct),
      }))
    : [];

  const pairSql = datePairsSql(table, plan.datePairs);
  const datePairs = pairSql
    ? (await query(pairSql)).map((r) => ({
        a: String(r.a),
        b: String(r.b),
        both: num(r.both_present),
        aBeforeB: num(r.a_before_b),
        bBeforeA: num(r.b_before_a),
      }))
    : [];

  const covSql = coverageSql(table, plan.coverage, today);
  const coverage: CoverageResult[] = plan.coverage.map((c) => ({ column: c.label, months: [], future: 0 }));
  if (covSql) {
    const byColumn = new Map(coverage.map((c) => [c.column, c]));
    for (const r of await query(covSql)) {
      const entry = byColumn.get(String(r.column_label));
      if (!entry) continue;
      entry.months.push({ month: num(r.month), rows: num(r.n) });
      entry.future += num(r.future);
    }
  }

  return {
    rows: totalRows,
    duplicateRows,
    singleKeys,
    pairKey,
    pairsChecked: plan.keyPairs.length,
    dependencies,
    datePairs,
    coverage,
  };
}

/** Today's local calendar date as yyyymmdd. */
export function todayKey(date: Date): number {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}
