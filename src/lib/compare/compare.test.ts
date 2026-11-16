import { beforeAll, describe, expect, it } from 'vitest';
import { openTestDb, type TestDb } from '../profile/duckdbNode.testutil';
import { columnFactsSql, toColumnFacts, valueCountsSql } from '../profile/factsSql';
import { createTableSql, readCsvSql } from '../profile/sql';
import type { ColumnStats, DateRange, MeasureStats, ProfileResult } from '../profile/types';
import { decideColumns } from '../rules/decide';
import type { ColumnDecision, ColumnFacts } from '../rules/types';
import { interpretTable } from '../table/interpret';
import { runTableChecks } from '../table/run';
import { compareProfiles, rowsDroppedSeriously } from './compare';
import { chooseKey, compareTables, sharedColumns } from './run';

type Profile = Pick<ProfileResult, 'columns' | 'profiledRows' | 'totalRows' | 'table'>;

// ---------- Hand-built profiles, for the rules ----------

function stats(
  name: string,
  decision: Partial<ColumnDecision>,
  extra: { facts?: Partial<ColumnFacts>; measure?: Partial<MeasureStats>; dateRange?: DateRange } = {},
): ColumnStats {
  return {
    name,
    sqlName: name,
    facts: { filled: 100, distinct: 10, ...extra.facts } as ColumnFacts,
    decision: { type: 'text', role: 'category', effectivelyMissing: 0, findings: [], ...decision },
    measure: extra.measure
      ? ({ min: 0, max: 10, mean: 5, median: 5, std: 1, ...extra.measure } as MeasureStats)
      : undefined,
    dateRange: extra.dateRange,
  } as ColumnStats;
}

const profile = (columns: ColumnStats[], rows = 100): Profile => ({
  columns,
  profiledRows: rows,
  totalRows: rows,
  table: null,
});
const changesOf = (now: ColumnStats, before: ColumnStats, rows = 100) =>
  compareProfiles(profile([now], rows), profile([before], 100), [], 'UK').columns[0]?.changes ?? [];

describe('compareProfiles', () => {
  it('reports columns added, removed, renamed and reordered', () => {
    const earlier = profile([stats('Order ID', {}), stats('order_date', {}), stats('Region', {}), stats('Notes', {})]);
    const current = profile([
      stats('Region', {}),
      stats('Order ID', {}),
      stats('Order Date', {}),
      stats('Channel', {}),
    ]);
    const result = compareProfiles(current, earlier, [], 'UK');
    expect(result.added).toEqual(['Channel']);
    expect(result.removed).toEqual(['Notes']);
    expect(result.renamed).toEqual([{ from: 'order_date', to: 'Order Date' }]);
    expect(result.reordered).toBe(true);
    expect(result.headline).toBe(
      'The same number of rows (100), 3 column changes, no notable changes inside the columns.',
    );
  });

  it('treats a change of type as serious', () => {
    const [change] = changesOf(
      stats('Amount', { type: 'text' }),
      stats('Amount', { type: 'decimal', role: 'measure' }),
    );
    expect(change).toMatchObject({ severity: 'high' });
    expect(change.text).toContain('Type changed from decimal to text');
  });

  it('flags a date column whose day/month order changed', () => {
    const date = (order: 'day-first' | 'month-first') =>
      stats('Seen', { type: 'date', role: 'date', date: { order, basis: 'evidence', evidence: 9 } });
    expect(changesOf(date('month-first'), date('day-first'))[0]).toMatchObject({ severity: 'high' });
  });

  it('reports missing values that appear, grow or go away, and ignores small movements', () => {
    const missing = (n: number) => stats('City', { effectivelyMissing: n });
    expect(changesOf(missing(8), missing(0))[0]).toMatchObject({
      severity: 'warn',
      text: 'Now has missing values: 8.0% of rows. It had none.',
    });
    expect(changesOf(missing(30), missing(10))[0].text).toBe('More values are missing: 30% of rows, up from 10%.');
    expect(changesOf(missing(0), missing(12))[0]).toMatchObject({ severity: 'info' });
    expect(changesOf(missing(21), missing(21))).toEqual([]);
  });

  it('reports a shifted average and a suspicious new maximum', () => {
    const amount = (mean: number, max: number) =>
      stats('Amount', { type: 'decimal', role: 'measure' }, { measure: { mean, max } });
    const texts = changesOf(amount(140, 9000), amount(100, 900)).map((c) => c.text);
    expect(texts).toHaveLength(2);
    expect(texts).toContain('The average rose 40%, from 100 to 140.');
    expect(texts.some((t) => t.startsWith('The largest value is now 9,000, more than double the earlier 900'))).toBe(
      true,
    );
    expect(changesOf(amount(104, 900), amount(100, 900))).toEqual([]);
  });

  it('warns when the latest date goes backwards', () => {
    const dated = (first: number, last: number) =>
      stats('Order Date', { type: 'date', role: 'date' }, { dateRange: { first, last } });
    expect(changesOf(dated(20250101, 20251130), dated(20250101, 20251231))[0]).toMatchObject({ severity: 'warn' });
    expect(changesOf(dated(20250101, 20260131), dated(20250101, 20251231))[0].text).toBe(
      'Now runs to 31 Jan 2026; it ran to 31 Dec 2025.',
    );
  });

  it('flags an identifier that used to be unique and now repeats', () => {
    const id = (distinct: number) =>
      stats('Order ID', { type: 'integer', role: 'identifier' }, { facts: { filled: 100, distinct } });
    expect(changesOf(id(96), id(100))[0]).toMatchObject({ severity: 'high' });
    expect(changesOf(id(100), id(100))).toEqual([]);
  });

  it('lists new and gone category values', () => {
    const result = compareProfiles(
      profile([stats('Status', {})]),
      profile([stats('Status', {})]),
      [{ column: 'Status', added: ['On hold'], removed: ['Draft', 'Void'] }],
      'UK',
    );
    expect(result.columns[0].changes.map((c) => c.text)).toEqual([
      'A new value: "On hold". Reports that group by this column may need updating.',
      '2 values no longer appear: "Draft", "Void".',
    ]);
  });

  it('lists findings that are new and those that have gone', () => {
    const finding = (kind: 'placeholders' | 'numbers-as-text', title: string) => ({
      kind,
      severity: 'warn' as const,
      title,
      detail: '',
    });
    const earlier = profile([
      stats('Priority', { findings: [finding('placeholders', 'Placeholders hide 30 blanks')] }),
    ]);
    const current = profile([stats('Priority', { findings: [finding('numbers-as-text', 'Numbers stored as text')] })]);
    const { findings } = compareProfiles(current, earlier, [], 'UK');
    expect(findings.fresh).toEqual([{ column: 'Priority', title: 'Numbers stored as text', severity: 'warn' }]);
    expect(findings.resolved).toEqual([{ column: 'Priority', title: 'Placeholders hide 30 blanks', severity: 'warn' }]);
  });

  it('knows a serious drop in rows', () => {
    expect(rowsDroppedSeriously({ earlier: 1000, current: 880 })).toBe(true);
    expect(rowsDroppedSeriously({ earlier: 1000, current: 960 })).toBe(false);
    expect(rowsDroppedSeriously({ earlier: 1000, current: 1400 })).toBe(false);
  });
});

// ---------- Real tables, for the SQL ----------

let db: TestDb;

async function load(table: string, csv: string): Promise<Profile> {
  db.addFile(`${table}.csv`, csv);
  db.run(`DROP TABLE IF EXISTS "${table}"`);
  db.run(
    createTableSql(
      table,
      readCsvSql({ fileName: `${table}.csv`, delimiter: ',', hasHeader: true, skipBrokenRows: false }),
      false,
    ),
  );
  db.run(valueCountsSql(table));
  const evidence = new Map(db.rows(columnFactsSql()).map((r) => [String(r.column_name), r]));
  const facts = db.rows(`DESCRIBE "${table}"`).map((r) => {
    const name = String(r.column_name);
    return { name, facts: toColumnFacts(evidence.get(name) ?? { filled: 0, distinct_values: 0 }) };
  });
  const [{ n }] = db.rows(`SELECT count(*) AS n FROM "${table}"`);
  const rows = Number(n);
  const columns = decideColumns(facts, rows, 'UK').map((c, i) => ({
    ...c,
    sqlName: c.name,
    facts: facts[i].facts,
  })) as ColumnStats[];
  const results = await runTableChecks(async (sql) => db.rows(sql), table, columns, rows, 20261116);
  return {
    columns,
    profiledRows: rows,
    totalRows: rows,
    table: interpretTable(results, { sampled: false, region: 'UK' }),
  };
}

const EARLIER = [
  'Order ID,Status,Amount,Customer',
  ...Array.from(
    { length: 30 },
    (_, i) => `${1000 + i},${['Open', 'Closed', 'Draft'][i % 3]},${(i + 1) * 10},C${i % 7}`,
  ),
].join('\n');

// Orders 1000 and 1001 are gone; 1030 to 1033 are new; 1005's amount and 1007's status and amount changed;
// "Draft" became "On hold" from 1020 on.
const CURRENT = [
  'Order ID,Status,Amount,Customer',
  ...Array.from({ length: 34 }, (_, i) => i)
    .filter((i) => i >= 2)
    .map((i) => {
      let status = ['Open', 'Closed', 'Draft'][i % 3];
      if (status === 'Draft' && i >= 20) status = 'On hold';
      let amount = (i + 1) * 10;
      if (i === 5) amount = 999;
      if (i === 7) {
        amount = 1;
        status = 'Open';
      }
      return `${1000 + i},${status},${amount},C${i % 7}`;
    }),
].join('\n');

describe('compareTables', () => {
  let current: Profile;
  let earlier: Profile;
  beforeAll(async () => {
    db = await openTestDb();
    current = await load('data', CURRENT);
    earlier = await load('earlier', EARLIER);
  });

  it('matches rows on the key both files share', async () => {
    expect(chooseKey(current, earlier)).toBe('Order ID');
    expect(sharedColumns(current, earlier).map((c) => c.name)).toEqual(['Order ID', 'Status', 'Amount', 'Customer']);

    const { rows, noRowsReason } = await compareTables(
      async (sql) => db.rows(sql),
      { table: 'data', result: current },
      { table: 'earlier', result: earlier },
    );
    expect(noRowsReason).toBeNull();
    expect(rows).toMatchObject({ key: 'Order ID', added: 4, removed: 2, kept: 28 });
    // 1005 and 1007 were edited; 1020, 1023, 1026 and 1029 went from Draft to On hold.
    expect(rows?.changed).toBe(6);
    expect(rows?.byColumn).toEqual([
      { column: 'Status', rows: 5 },
      { column: 'Amount', rows: 2 },
    ]);
    expect(rows?.examples.added).toEqual(['1030', '1031', '1032', '1033']);
    expect(rows?.examples.removed).toEqual(['1000', '1001']);
    expect(rows?.examples.changed.slice(0, 2)).toEqual([
      { key: '1005', columns: ['Amount'] },
      { key: '1007', columns: ['Status', 'Amount'] },
    ]);
  });

  it('finds category values that are new or gone', async () => {
    const { values } = await compareTables(
      async (sql) => db.rows(sql),
      { table: 'data', result: current },
      { table: 'earlier', result: earlier },
    );
    expect(values).toEqual([{ column: 'Status', added: ['On hold'], removed: [] }]);
  });

  it('says why rows cannot be matched when there is no shared key', async () => {
    const noKey = await load('nokey', 'Team,Score\nA,1\nA,2\nB,1\nB,2\n');
    const result = await compareTables(
      async (sql) => db.rows(sql),
      { table: 'nokey', result: noKey },
      { table: 'nokey', result: noKey },
    );
    expect(result.rows).toBeNull();
    expect(result.noRowsReason).toContain('no column is filled in and different on every row in both files');

    const sampled = { ...current, totalRows: 5000 };
    const partial = await compareTables(
      async (sql) => db.rows(sql),
      { table: 'data', result: sampled },
      { table: 'earlier', result: earlier },
    );
    expect(partial.noRowsReason).toContain('profiled in full');
  });
});
