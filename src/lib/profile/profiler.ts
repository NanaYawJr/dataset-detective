import { detectFormat, type FormatReport } from '../format/detectFormat';
import { decode } from '../format/detectFormat';
import { getDuckDb, duckdb } from './duckdb';
import {
  columnSummarySql,
  createTableSql,
  needsTranscoding,
  quoteIdent,
  readCsvSql,
  shapesSql,
  topValuesSql,
} from './sql';
import type { ColumnStats, ProfileResult, Scope, Step, ValueCount } from './types';

/** How much of the file is read to detect its format. */
export const FORMAT_SAMPLE_BYTES = 1024 * 1024;

const TABLE = 'data';
const SOURCE_FILE = 'input.csv';

export async function inspectFile(file: File): Promise<FormatReport> {
  const slice = file.slice(0, FORMAT_SAMPLE_BYTES);
  const bytes = new Uint8Array(await slice.arrayBuffer());
  return detectFormat(bytes, file.size > FORMAT_SAMPLE_BYTES);
}

export interface ProfileOptions {
  scope: Scope;
  skipBrokenRows: boolean;
  onStep?: (step: Step) => void;
}

function toNumber(value: unknown): number {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value;
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function toNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : toNumber(value);
}

type Row = Record<string, unknown>;

async function rows(conn: duckdb.AsyncDuckDBConnection, sql: string): Promise<Row[]> {
  const result = await conn.query(sql);
  return result.toArray().map((r) => r.toJSON() as Row);
}

function valueCounts(list: Row[], key: string): ValueCount[] {
  return list.map((r) => ({ value: String(r[key]), count: toNumber(r.n) }));
}

async function registerSource(db: duckdb.AsyncDuckDB, file: File, format: FormatReport) {
  await db.dropFile(SOURCE_FILE).catch(() => undefined);
  if (needsTranscoding(format.encoding)) {
    // DuckDB reads UTF-8; convert other encodings in memory first.
    const text = decode(new Uint8Array(await file.arrayBuffer()), format.encoding);
    await db.registerFileBuffer(SOURCE_FILE, new TextEncoder().encode(text));
  } else {
    await db.registerFileHandle(SOURCE_FILE, file, duckdb.DuckDBDataProtocol.BROWSER_FILEREADER, true);
  }
}

async function countRejectedLines(conn: duckdb.AsyncDuckDBConnection): Promise<number> {
  try {
    const [row] = await rows(conn, 'SELECT count(DISTINCT line) AS n FROM reject_errors');
    return toNumber(row?.n);
  } catch {
    return 0;
  }
}

async function clearRejects(conn: duckdb.AsyncDuckDBConnection) {
  await conn.query('DROP TABLE IF EXISTS reject_errors').catch(() => undefined);
  await conn.query('DROP TABLE IF EXISTS reject_scans').catch(() => undefined);
}

export async function profileFile(file: File, format: FormatReport, options: ProfileOptions): Promise<ProfileResult> {
  const started = performance.now();
  const step = options.onStep ?? (() => undefined);

  step('load');
  const db = await getDuckDb();
  await registerSource(db, file, format);
  const conn = await db.connect();

  try {
    await clearRejects(conn);
    const read = (recordRejects: boolean) =>
      readCsvSql({
        fileName: SOURCE_FILE,
        delimiter: format.delimiter,
        hasHeader: format.hasHeader,
        skipBrokenRows: options.skipBrokenRows,
        recordRejects,
      });

    let totalRows: number;
    let skippedRows = 0;

    if (options.scope === 'sample') {
      const [count] = await rows(conn, `SELECT count(*) AS n FROM ${read(options.skipBrokenRows)}`);
      totalRows = toNumber(count.n);
      if (options.skipBrokenRows) skippedRows = await countRejectedLines(conn);
      await conn.query(createTableSql(TABLE, read(false), true));
    } else {
      await conn.query(createTableSql(TABLE, read(options.skipBrokenRows), false));
      const [count] = await rows(conn, `SELECT count(*) AS n FROM ${quoteIdent(TABLE)}`);
      totalRows = toNumber(count.n);
      if (options.skipBrokenRows) skippedRows = await countRejectedLines(conn);
    }

    const [profiled] = await rows(conn, `SELECT count(*) AS n FROM ${quoteIdent(TABLE)}`);
    const profiledRows = toNumber(profiled.n);

    // DuckDB's own column names (it renames blank and duplicate headers).
    const described = await rows(conn, `DESCRIBE ${quoteIdent(TABLE)}`);
    const sqlNames = described.map((r) => String(r.column_name));
    const displayName = (sqlName: string, index: number) => (format.hasHeader ? sqlName : `Column ${index + 1}`);

    step('stats');
    const columns: ColumnStats[] = [];
    for (const [index, name] of sqlNames.entries()) {
      const [summary] = await rows(conn, columnSummarySql(TABLE, name));
      const top = await rows(conn, topValuesSql(TABLE, name));
      columns.push({
        name: displayName(name, index),
        filled: toNumber(summary.filled),
        empty: toNumber(summary.empty),
        distinct: toNumber(summary.distinct_values),
        minLength: toNullableNumber(summary.min_length),
        maxLength: toNullableNumber(summary.max_length),
        topValues: valueCounts(top, 'value'),
        shapes: [],
      });
    }

    step('shapes');
    for (const [index, name] of sqlNames.entries()) {
      columns[index].shapes = valueCounts(await rows(conn, shapesSql(TABLE, name)), 'shape');
    }

    return {
      fileName: file.name,
      fileSize: file.size,
      format,
      scope: options.scope,
      totalRows,
      profiledRows,
      skippedRows,
      columns,
      profiledAt: new Date(),
      durationMs: performance.now() - started,
    };
  } finally {
    await conn.close();
  }
}
