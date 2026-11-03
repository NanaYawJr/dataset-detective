import { dateKey } from '../profile/factsSql';
import { quoteIdent, quoteLiteral } from '../profile/sql';
import type { ColumnExpr, CoveragePlan, DatePairPlan } from './types';

/** SQL for the whole-table checks. Each function returns one query. */

const nonBlank = (sql: string) => `(${sql} IS NOT NULL AND trim(${sql}) <> '')`;

/** Total rows, distinct rows (for exact duplicates) and one count per candidate key pair. */
export function keysSql(table: string, keyPairs: [ColumnExpr, ColumnExpr][]): string {
  const t = quoteIdent(table);
  const pairCounts = keyPairs.map(([a, b], i) => `count(DISTINCT (${a.sql}, ${b.sql})) AS pair_${i}`);
  return `SELECT
  (SELECT count(*) FROM ${t}) AS total_rows,
  (SELECT count(*) FROM (SELECT DISTINCT * FROM ${t})) AS distinct_rows${pairCounts.length ? `,\n  ${pairCounts.join(',\n  ')}` : ''}
FROM ${t}`;
}

/**
 * For each pair, tests "each A has exactly one B" in both directions. Each
 * pair is grouped once; both directions are read from that small result.
 */
export function dependenciesSql(table: string, pairs: [ColumnExpr, ColumnExpr][]): string | null {
  if (pairs.length === 0) return null;
  const t = quoteIdent(table);
  const ctes = pairs.map(
    ([a, b], i) => `p${i} AS (
    SELECT ${a.sql} AS x, ${b.sql} AS y, count(*) AS r
    FROM ${t}
    WHERE ${nonBlank(a.sql)} AND ${nonBlank(b.sql)}
    GROUP BY 1, 2
  )`,
  );
  const direction = (i: number, from: ColumnExpr, to: ColumnExpr, k: 'x' | 'y', v: 'x' | 'y', idx: number) => `SELECT
    ${idx} AS idx,
    ${quoteLiteral(from.label)} AS from_label,
    ${quoteLiteral(to.label)} AS to_label,
    count(*) AS keys,
    count(*) FILTER (WHERE rows_k > 1) AS repeated,
    count(*) FILTER (WHERE n_to > 1) AS violating,
    list(k ORDER BY k) FILTER (WHERE n_to > 1)[1:3] AS examples,
    (SELECT count(DISTINCT ${v}) FROM p${i}) AS to_distinct
  FROM (SELECT ${k} AS k, count(*) AS n_to, sum(r) AS rows_k FROM p${i} GROUP BY 1)`;
  // idx is 2i for "a has one b" and 2i+1 for the reverse, so results can be matched to the plan.
  const selects = pairs.flatMap(([a, b], i) => [
    direction(i, a, b, 'x', 'y', 2 * i),
    direction(i, b, a, 'y', 'x', 2 * i + 1),
  ]);
  return `WITH ${ctes.join(',\n  ')}\n${selects.join('\nUNION ALL\n')}\nORDER BY idx`;
}

/**
 * For each pair of date columns, how often each comes first. Rows are grouped
 * by their pair of values first, so each distinct pair of dates is parsed once.
 */
export function datePairsSql(table: string, pairs: DatePairPlan[]): string | null {
  if (pairs.length === 0) return null;
  const parts = pairs.map(({ a, b }) => {
    const ka = dateKey('va', a.order);
    const kb = dateKey('vb', b.order);
    return `SELECT ${quoteLiteral(a.label)} AS a, ${quoteLiteral(b.label)} AS b,
    coalesce(sum(n) FILTER (WHERE ka IS NOT NULL AND kb IS NOT NULL), 0) AS both_present,
    coalesce(sum(n) FILTER (WHERE ka < kb), 0) AS a_before_b,
    coalesce(sum(n) FILTER (WHERE kb < ka), 0) AS b_before_a
  FROM (
    SELECT ${ka} AS ka, ${kb} AS kb, n
    FROM (SELECT ${quoteIdent(a.sqlName)} AS va, ${quoteIdent(b.sqlName)} AS vb, count(*) AS n FROM ${quoteIdent(table)} GROUP BY 1, 2)
  )`;
  });
  return parts.join('\nUNION ALL\n');
}

/**
 * Rows per calendar month for each date column, plus rows dated after today
 * (as yyyymmdd). Each distinct value is parsed once.
 */
export function coverageSql(table: string, columns: CoveragePlan[], today: number): string | null {
  if (columns.length === 0) return null;
  const parts = columns.map(({ label, sqlName, order }) => {
    const key = dateKey('v', order);
    return `SELECT ${quoteLiteral(label)} AS column_label, key // 100 AS month, sum(n) AS n, coalesce(sum(n) FILTER (WHERE key > ${today}), 0) AS future
  FROM (
    SELECT ${key} AS key, n
    FROM (SELECT ${quoteIdent(sqlName)} AS v, count(*) AS n FROM ${quoteIdent(table)} GROUP BY 1)
  )
  WHERE key IS NOT NULL
  GROUP BY 2`;
  });
  return `${parts.join('\nUNION ALL\n')}\nORDER BY column_label, month`;
}
