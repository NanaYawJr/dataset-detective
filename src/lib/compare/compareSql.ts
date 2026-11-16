import { quoteIdent, quoteLiteral } from '../profile/sql';

/** SQL that compares two loaded tables. `n` is the current file, `o` the earlier one. */

export interface ColumnPair {
  /** The name shown to the user (the same in both files). */
  name: string;
  current: string;
  earlier: string;
}

const text = (alias: string, column: string) => `nullif(trim(${alias}.${quoteIdent(column)}), '')`;

/** Counts of rows added, removed, kept and changed, matched on the key, with a count per column. */
export function rowDiffSql(current: string, earlier: string, key: ColumnPair, shared: ColumnPair[]): string {
  const differs = (c: ColumnPair) => `${text('n', c.current)} IS DISTINCT FROM ${text('o', c.earlier)}`;
  const both = 'n.k IS NOT NULL AND o.k IS NOT NULL';
  const anyDiffers = shared.length > 0 ? shared.map(differs).join(' OR ') : 'false';
  const perColumn = shared.map((c, i) => `count(*) FILTER (WHERE ${both} AND ${differs(c)}) AS c${i}`);
  return `SELECT
  count(*) FILTER (WHERE o.k IS NULL) AS added,
  count(*) FILTER (WHERE n.k IS NULL) AS removed,
  count(*) FILTER (WHERE ${both}) AS kept,
  count(*) FILTER (WHERE ${both} AND (${anyDiffers})) AS changed${perColumn.length ? `,\n  ${perColumn.join(',\n  ')}` : ''}
FROM (SELECT *, ${quoteIdent(key.current)} AS k FROM ${quoteIdent(current)}) n
FULL OUTER JOIN (SELECT *, ${quoteIdent(key.earlier)} AS k FROM ${quoteIdent(earlier)}) o ON n.k = o.k`;
}

/** A few example keys of each kind, and for changed rows which columns changed. */
export function rowExamplesSql(
  current: string,
  earlier: string,
  key: ColumnPair,
  shared: ColumnPair[],
  limit = 5,
): string {
  const differs = (c: ColumnPair) => `${text('n', c.current)} IS DISTINCT FROM ${text('o', c.earlier)}`;
  const changedColumns = shared.length
    ? `concat_ws(chr(31), ${shared.map((c) => `CASE WHEN ${differs(c)} THEN ${quoteLiteral(c.name)} END`).join(', ')})`
    : `''`;
  const joined = `(SELECT *, ${quoteIdent(key.current)} AS k FROM ${quoteIdent(current)}) n
  FULL OUTER JOIN (SELECT *, ${quoteIdent(key.earlier)} AS k FROM ${quoteIdent(earlier)}) o ON n.k = o.k`;
  return `(SELECT 'added' AS kind, n.k AS k, '' AS cols FROM ${joined} WHERE o.k IS NULL ORDER BY n.k LIMIT ${limit})
UNION ALL
(SELECT 'removed', o.k, '' FROM ${joined} WHERE n.k IS NULL ORDER BY o.k LIMIT ${limit})
UNION ALL
(SELECT 'changed', k, cols FROM (SELECT n.k AS k, ${changedColumns} AS cols FROM ${joined} WHERE n.k IS NOT NULL AND o.k IS NOT NULL) WHERE cols <> '' ORDER BY k LIMIT ${limit})`;
}

/** For each column, the values that appear in only one of the two files. */
export function valueSetsSql(current: string, earlier: string, columns: ColumnPair[], limit = 20): string | null {
  if (columns.length === 0) return null;
  const parts = columns.map(
    (c) => `(SELECT ${quoteLiteral(c.name)} AS column_name, coalesce(n.v, o.v) AS v, o.v IS NULL AS is_new
  FROM (SELECT DISTINCT ${text('t', c.current)} AS v FROM ${quoteIdent(current)} t) n
  FULL OUTER JOIN (SELECT DISTINCT ${text('t', c.earlier)} AS v FROM ${quoteIdent(earlier)} t) o ON n.v = o.v
  WHERE (n.v IS NULL OR o.v IS NULL) AND coalesce(n.v, o.v) IS NOT NULL
  ORDER BY 2 LIMIT ${limit})`,
  );
  return parts.join('\nUNION ALL\n');
}
