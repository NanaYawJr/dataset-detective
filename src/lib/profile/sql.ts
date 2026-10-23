import type { Delimiter, Encoding } from '../format/detectFormat';

/** Quotes an identifier (column or table name) for DuckDB. */
export function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** Quotes a string literal for DuckDB. */
export function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export interface ReadOptions {
  fileName: string;
  delimiter: Delimiter;
  hasHeader: boolean;
  /** Skip rows with the wrong number of fields instead of failing. */
  skipBrokenRows: boolean;
  /** Record skipped rows in DuckDB's reject_errors table so they can be counted. */
  recordRejects?: boolean;
}

/**
 * Builds the read_csv call. Every column is read as text: deciding what
 * type a column really is (number, date, ID) is the rule engine's job,
 * not the CSV reader's. This keeps values like 03/04/2026 exactly as
 * written, instead of letting the reader guess a date order.
 */
export function readCsvSql(options: ReadOptions): string {
  const args = [
    quoteLiteral(options.fileName),
    `delim = ${quoteLiteral(options.delimiter)}`,
    `header = ${options.hasHeader}`,
    `quote = '"'`,
    `escape = '"'`,
    'all_varchar = true',
    'null_padding = false',
  ];
  if (options.skipBrokenRows) {
    args.push('ignore_errors = true');
    if (options.recordRejects) args.push('store_rejects = true');
  }
  return `read_csv(${args.join(', ')})`;
}

export const SAMPLE_ROWS = 100_000;
export const SAMPLE_SEED = 42;

export function createTableSql(table: string, source: string, sample: boolean): string {
  const sampling = sample ? ` USING SAMPLE reservoir(${SAMPLE_ROWS} ROWS) REPEATABLE (${SAMPLE_SEED})` : '';
  return `CREATE OR REPLACE TABLE ${quoteIdent(table)} AS SELECT * FROM ${source}${sampling}`;
}

/** Text that counts as empty: NULL, or only whitespace. */
const isFilled = (col: string) => `(${col} IS NOT NULL AND trim(${col}) <> '')`;

export function columnSummarySql(table: string, column: string): string {
  const c = quoteIdent(column);
  return `SELECT
  count(*) FILTER (WHERE ${isFilled(c)}) AS filled,
  count(*) FILTER (WHERE NOT ${isFilled(c)}) AS empty,
  count(DISTINCT ${c}) FILTER (WHERE ${isFilled(c)}) AS distinct_values,
  min(length(${c})) FILTER (WHERE ${isFilled(c)}) AS min_length,
  max(length(${c})) FILTER (WHERE ${isFilled(c)}) AS max_length
FROM ${quoteIdent(table)}`;
}

export function topValuesSql(table: string, column: string, limit = 5): string {
  const c = quoteIdent(column);
  return `SELECT ${c} AS value, count(*) AS n
FROM ${quoteIdent(table)}
WHERE ${isFilled(c)}
GROUP BY ${c}
ORDER BY n DESC, value
LIMIT ${limit}`;
}

/**
 * Value shapes: digits become 9, letters become A, everything else is
 * kept. "LS1 4AB" becomes "AA9 9AA" and "03/04/2026" becomes "99/99/9999".
 */
export function shapesSql(table: string, column: string, limit = 3): string {
  const c = quoteIdent(column);
  return `SELECT left(regexp_replace(regexp_replace(${c}, '[0-9]', '9', 'g'), '[A-Za-z]', 'A', 'g'), 40) AS shape,
  count(*) AS n
FROM ${quoteIdent(table)}
WHERE ${isFilled(c)}
GROUP BY shape
ORDER BY n DESC, shape
LIMIT ${limit}`;
}

/** Encodings DuckDB can read directly; others are converted to UTF-8 first. */
export function needsTranscoding(encoding: Encoding): boolean {
  return encoding !== 'utf-8';
}
