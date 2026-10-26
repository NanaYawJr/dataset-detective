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

/** Encodings DuckDB can read directly; others are converted to UTF-8 first. */
export function needsTranscoding(encoding: Encoding): boolean {
  return encoding !== 'utf-8';
}
