import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { openTestDb, type TestDb } from '../profile/duckdbNode.testutil';
import { columnFactsSql, toColumnFacts, valueCountsSql } from '../profile/factsSql';
import { createTableSql, readCsvSql } from '../profile/sql';
import { decideColumns } from '../rules/decide';
import { interpretTable } from './interpret';
import { runTableChecks } from './run';
import type { TableColumn, TableReport, TableResults } from './types';

/** The whole-table checks, run by the real engine on the golden sample and small fixtures. */

let db: TestDb;
const TODAY = 20261103;

function load(table: string, text: string): TableColumn[] {
  db.addFile(`${table}.csv`, text);
  db.run(
    createTableSql(
      table,
      readCsvSql({ fileName: `${table}.csv`, delimiter: ',', hasHeader: true, skipBrokenRows: false }),
      false,
    ),
  );
  db.run(valueCountsSql(table));
  const facts = db.rows(columnFactsSql()).map((r) => ({ name: String(r.column_name), facts: toColumnFacts(r) }));
  const order = db.rows(`DESCRIBE "${table}"`).map((r) => String(r.column_name));
  facts.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  const [{ n }] = db.rows(`SELECT count(*) AS n FROM "${table}"`);
  return decideColumns(facts, Number(n), 'UK').map((c, i) => ({
    ...facts[i],
    decision: c.decision,
    sqlName: facts[i].name,
  }));
}

async function check(table: string, text: string): Promise<{ results: TableResults; report: TableReport }> {
  const columns = load(table, text);
  const [{ n }] = db.rows(`SELECT count(*) AS n FROM "${table}"`);
  const results = await runTableChecks(async (sql) => db.rows(sql), table, columns, Number(n), TODAY);
  return { results, report: interpretTable(results, { sampled: false, region: 'UK' }) };
}

const kinds = (report: TableReport) => report.findings.map((f) => f.kind);

beforeAll(async () => {
  db = await openTestDb();
});

describe('golden sample', () => {
  let results: TableResults;
  let report: TableReport;
  beforeAll(async () => {
    const golden = readFileSync(new URL('../../../samples/sales-sample.csv', import.meta.url), 'utf8');
    ({ results, report } = await check('sales', golden));
  });

  it('has no exact duplicate rows and no single-column key', () => {
    expect(results.rows).toBe(1378);
    expect(results.duplicateRows).toBe(0);
    expect(results.singleKeys).toEqual([]);
    expect(results.pairsChecked).toBeGreaterThan(0);
  });

  it('finds that each City has one Region inside the packed column', () => {
    const finding = report.findings.find((f) => f.kind === 'dependency' && f.columns[0] === 'City | Region');
    expect(finding?.title).toBe('Each City has exactly one Region');
    expect(finding?.detail).toMatch(/^Inside City \| Region, all 12 values of City/);
  });

  it('finds the rows shipped before they were ordered', () => {
    const finding = report.findings.find((f) => f.kind === 'event-order-broken');
    expect(finding).toMatchObject({ columns: ['Order Date', 'Ship Date'], rows: 4 });
    expect(finding?.title).toBe('Ship Date is before Order Date in 4 rows');
  });

  it('finds the missing month of orders', () => {
    const gap = report.findings.find((f) => f.kind === 'date-gaps' && f.columns[0] === 'Order Date');
    expect(gap?.title).toBe('No rows in Jul 2025');
  });

  it('reports no future dates', () => {
    expect(kinds(report)).not.toContain('future-dates');
  });
});

describe('fixtures', () => {
  it('counts exact duplicate rows', async () => {
    const text = 'id,name\n1,a\n2,b\n2,b\n3,c\n3,c\n3,c\n';
    const { results, report } = await check('dupes', text);
    expect(results.duplicateRows).toBe(3);
    expect(report.findings[0]).toMatchObject({ kind: 'duplicate-rows', severity: 'high', rows: 3 });
  });

  it('names a single-column key as the grain', async () => {
    const text =
      'Ticket,Status\n' + Array.from({ length: 30 }, (_, i) => `T${i},${i % 2 ? 'open' : 'closed'}`).join('\n');
    const { report } = await check('tickets', text);
    expect(report.grain).toBe('Each row is one Ticket');
  });

  it('finds a two-column key', async () => {
    const lines = ['Store,Day,Sales'];
    for (const store of ['A', 'B', 'C'])
      for (let d = 1; d <= 10; d += 1) lines.push(`${store},2026-01-${String(d).padStart(2, '0')},${d * 3}`);
    const { report } = await check('stores', lines.join('\n'));
    expect(report.grain).toMatch(/^Each row is one combination of (Store and Day|Day and Store)$/);
  });

  it('flags a nearly-exact dependency and names the odd value', async () => {
    const lines = ['Code,Country'];
    const codes: [string, string][] = [];
    for (let i = 0; i < 40; i += 1) codes.push([`C${i}`, `Country ${i % 8}`]);
    for (const [code, country] of codes) lines.push(`${code},${country}`, `${code},${country}`);
    lines.push('C7,Country 3');
    const { report } = await check('codes', lines.join('\n'));
    const broken = report.findings.find((f) => f.kind === 'dependency-broken' && f.columns[0] === 'Code');
    expect(broken?.title).toBe('1 value of Code map to more than one Country');
    expect(broken?.detail).toContain('"C7"');
  });

  it('flags dates after today', async () => {
    const lines = ['When'];
    for (let i = 1; i <= 28; i += 1) lines.push(`2026-10-${String(i).padStart(2, '0')}`);
    lines.push('2027-05-01', '2031-01-01');
    const { report } = await check('future', lines.join('\n'));
    expect(report.findings.find((f) => f.kind === 'future-dates')).toMatchObject({ rows: 2, columns: ['When'] });
  });
});
