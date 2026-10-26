import { decode, detectFormat, type FormatReport } from '../format/detectFormat';
import type { Region } from '../region';
import { decideColumns } from '../rules/decide';
import type { ColumnDecision, ColumnFacts } from '../rules/types';
import { getDuckDb, duckdb } from './duckdb';
import {
  columnFactsSql,
  shapesAllSql,
  toColumnFacts,
  topValuesAllSql,
  typedStatsSql,
  valueCountsSql,
  type TypedColumn,
} from './factsSql';
import { createTableSql, needsTranscoding, quoteIdent, readCsvSql } from './sql';
import type { ColumnStats, DateRange, MeasureStats, ProfileResult, Scope, Step, ValueCount } from './types';

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
  region: Region;
  onStep?: (step: Step) => void;
}

type Row = Record<string, unknown>;
type Connection = duckdb.AsyncDuckDBConnection;

function toNumber(value: unknown): number {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value;
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function toNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : toNumber(value);
}

async function rows(conn: Connection, sql: string): Promise<Row[]> {
  const result = await conn.query(sql);
  return result.toArray().map((r) => r.toJSON() as Row);
}

/** Groups (column_name, value, n) rows into per-column lists. */
function groupValues(list: Row[]): Map<string, ValueCount[]> {
  const grouped = new Map<string, ValueCount[]>();
  for (const row of list) {
    const column = String(row.column_name);
    const values = grouped.get(column) ?? [];
    values.push({ value: String(row.value), count: toNumber(row.n) });
    grouped.set(column, values);
  }
  return grouped;
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

async function countRejectedLines(conn: Connection): Promise<number> {
  try {
    const [row] = await rows(conn, 'SELECT count(DISTINCT line) AS n FROM reject_errors');
    return toNumber(row?.n);
  } catch {
    return 0;
  }
}

async function clearRejects(conn: Connection) {
  await conn.query('DROP TABLE IF EXISTS reject_errors').catch(() => undefined);
  await conn.query('DROP TABLE IF EXISTS reject_scans').catch(() => undefined);
}

interface Decided {
  decision: ColumnDecision;
  measure?: MeasureStats;
  dateRange?: DateRange;
}

/**
 * Decides every column and computes the statistics that depend on the
 * decision. Uses the table already loaded, so it can be re-run cheaply
 * (for example when the region changes).
 */
async function decideAndMeasure(
  conn: Connection,
  columns: { name: string; sqlName: string; facts: ColumnFacts }[],
  rowCount: number,
  region: Region,
): Promise<Decided[]> {
  const decisions = decideColumns(
    columns.map(({ name, facts }) => ({ name, facts })),
    rowCount,
    region,
  );
  const typed: TypedColumn[] = columns.map((c, i) => ({ name: c.sqlName, decision: decisions[i].decision }));
  const sql = typedStatsSql(TABLE, typed);
  const [stats] = sql ? await rows(conn, sql) : [{} as Row];

  return decisions.map(({ decision }, i) => {
    const decided: Decided = { decision };
    if (stats[`n${i}_min`] !== undefined && stats[`n${i}_min`] !== null) {
      decided.measure = {
        min: toNumber(stats[`n${i}_min`]),
        max: toNumber(stats[`n${i}_max`]),
        mean: toNumber(stats[`n${i}_mean`]),
        median: toNumber(stats[`n${i}_median`]),
        std: toNullableNumber(stats[`n${i}_std`]),
      };
    }
    if (stats[`d${i}_min`] !== undefined && stats[`d${i}_min`] !== null) {
      decided.dateRange = { first: toNumber(stats[`d${i}_min`]), last: toNumber(stats[`d${i}_max`]) };
    }
    return decided;
  });
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

    // DuckDB's own column names, in file order (it renames blank and duplicate headers).
    const described = await rows(conn, `DESCRIBE ${quoteIdent(TABLE)}`);
    const sqlNames = described.map((r) => String(r.column_name));
    const displayName = (sqlName: string, index: number) => (format.hasHeader ? sqlName : `Column ${index + 1}`);

    step('evidence');
    await conn.query(valueCountsSql(TABLE));
    const factsByColumn = new Map((await rows(conn, columnFactsSql())).map((r) => [String(r.column_name), r]));
    const empty: Row = { filled: 0, distinct_values: 0 };
    const columns = sqlNames.map((sqlName, index) => ({
      name: displayName(sqlName, index),
      sqlName,
      facts: toColumnFacts(factsByColumn.get(sqlName) ?? empty),
    }));

    step('decide');
    const decided = await decideAndMeasure(conn, columns, profiledRows, options.region);

    step('stats');
    const top = groupValues(await rows(conn, topValuesAllSql()));
    const shapes = groupValues(await rows(conn, shapesAllSql()));

    const stats: ColumnStats[] = columns.map((column, i) => ({
      ...column,
      filled: column.facts.filled,
      empty: profiledRows - column.facts.filled,
      distinct: column.facts.distinct,
      minLength: column.facts.minLength,
      maxLength: column.facts.maxLength,
      topValues: top.get(column.sqlName) ?? [],
      shapes: shapes.get(column.sqlName) ?? [],
      ...decided[i],
    }));

    return {
      fileName: file.name,
      fileSize: file.size,
      format,
      scope: options.scope,
      region: options.region,
      totalRows,
      profiledRows,
      skippedRows,
      columns: stats,
      profiledAt: new Date(),
      durationMs: performance.now() - started,
    };
  } finally {
    await conn.close();
  }
}

/**
 * Re-decides the columns of the file that is still loaded, for a new region.
 * Only unproven date orders depend on the region, so this is quick.
 */
export async function redecide(result: ProfileResult, region: Region): Promise<ProfileResult> {
  const db = await getDuckDb();
  const conn = await db.connect();
  try {
    const decided = await decideAndMeasure(conn, result.columns, result.profiledRows, region);
    return {
      ...result,
      region,
      columns: result.columns.map((column, i) => {
        const { measure: _measure, dateRange: _dateRange, ...rest } = column;
        return { ...rest, ...decided[i] };
      }),
    };
  } finally {
    await conn.close();
  }
}
