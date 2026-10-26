import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { decideColumns } from '../rules/decide';
import { isValidNhsNumber } from '../rules/nhs';
import type { ColumnDecision, ColumnFacts } from '../rules/types';
import {
  columnFactsSql,
  shapesAllSql,
  toColumnFacts,
  topValuesAllSql,
  typedStatsSql,
  valueCountsSql,
} from './factsSql';
import { createTableSql, readCsvSql } from './sql';
import { openTestDb, type TestDb } from './duckdbNode.testutil';

/**
 * Integration tests: the real evidence SQL, run by the real DuckDB engine,
 * against the golden sample and a small personal-data fixture.
 */

let db: TestDb;
let facts: Map<string, ColumnFacts>;
let decisions: Map<string, ColumnDecision>;

const golden = readFileSync(new URL('../../../samples/sales-sample.csv', import.meta.url), 'utf8');
const ROWS = 1378;

function load(table: string, file: string, text: string) {
  db.addFile(file, text);
  db.run(
    createTableSql(
      table,
      readCsvSql({ fileName: file, delimiter: ',', hasHeader: true, skipBrokenRows: false }),
      false,
    ),
  );
}

function factsFor(table: string): Map<string, ColumnFacts> {
  db.run(valueCountsSql(table));
  return new Map(db.rows(columnFactsSql()).map((row) => [String(row.column_name), toColumnFacts(row)]));
}

beforeAll(async () => {
  db = await openTestDb();
  load('data', 'sales.csv', golden);
  facts = factsFor('data');
  const columns = [...facts].map(([name, f]) => ({ name, facts: f }));
  decisions = new Map(decideColumns(columns, ROWS, 'UK').map((c) => [c.name, c.decision]));
});

describe('evidence from the golden sample', () => {
  it('finds every column in one pass', () => {
    expect(facts.size).toBe(12);
  });

  it('sees that Order ID repeats', () => {
    expect(facts.get('Order ID')).toMatchObject({ filled: ROWS, distinct: 800, integers: ROWS });
  });

  it('proves the dates are day-first', () => {
    expect(facts.get('Order Date')).toMatchObject({ slashDates: ROWS, secondPartOver12: 0, impossibleSlashDates: 0 });
    expect(facts.get('Order Date')!.firstPartOver12).toBeGreaterThan(0);
  });

  it('finds the placeholder and names it', () => {
    expect(facts.get('Order Priority')).toMatchObject({ placeholders: 300, placeholderValues: ['4-Not Specified'] });
  });

  it('finds the packed field, the percent text and the emails', () => {
    expect(facts.get('City | Region')!.pipePairs).toBe(ROWS);
    expect(facts.get('Discount')!.percents).toBe(ROWS);
    expect(facts.get('Customer Email')!.emails).toBe(ROWS);
  });
});

describe('decisions for the golden sample', () => {
  it.each([
    ['Order ID', 'integer', 'identifier'],
    ['Order Date', 'date', 'date'],
    ['Ship Date', 'date', 'date'],
    ['Order Priority', 'text', 'category'],
    ['Order Quantity', 'integer', 'measure'],
    ['Discount', 'percent', 'measure'],
    ['Unit Price', 'decimal', 'measure'],
    ['Profit', 'decimal', 'measure'],
    ['Ship Mode', 'text', 'category'],
    ['City | Region', 'text', 'category'],
    ['Customer Segment', 'text', 'category'],
    ['Customer Email', 'text', 'personal'],
  ])('%s is %s / %s', (name, type, role) => {
    expect(decisions.get(name)).toMatchObject({ type, role });
  });

  it('records the deliberate problems as findings', () => {
    const kindsOf = (name: string) => decisions.get(name)!.findings.map((f) => f.kind);
    expect(kindsOf('Order ID')).toContain('not-unique');
    expect(kindsOf('Discount')).toContain('numbers-as-text');
    expect(kindsOf('City | Region')).toContain('packed-field');
    expect(kindsOf('Order Priority')).toEqual(expect.arrayContaining(['placeholders', 'rank-in-text']));
    expect(kindsOf('Order Date')).toContain('date-order-proven');
    expect(kindsOf('Customer Email')).toContain('personal-data');
  });
});

describe('typed statistics', () => {
  it('computes measures and date ranges in one query', () => {
    const columns = [...decisions].map(([name, decision]) => ({ name, decision }));
    const sql = typedStatsSql('data', columns);
    expect(sql).not.toBeNull();
    const [row] = db.rows(sql!);
    const index = (name: string) => columns.findIndex((c) => c.name === name);

    const orderDate = index('Order Date');
    expect(row[`d${orderDate}_min`]).toBe(20250101);
    expect(row[`d${orderDate}_max`]).toBe(20251231);

    const shipDate = index('Ship Date');
    expect(row[`d${shipDate}_max`]).toBe(20260106);

    const discount = index('Discount');
    expect(row[`n${discount}_min`]).toBe(0);
    expect(row[`n${discount}_max`]).toBe(10);
    expect(row[`n${discount}_median`]).toBe(5);

    const profit = index('Profit');
    expect(row[`n${profit}_mean`]).toBeCloseTo(75.3912, 3);
    expect(row[`n${profit}_median`]).toBeCloseTo(2.63, 2);

    // Identifiers don't get averages.
    expect(row).not.toHaveProperty(`n${index('Order ID')}_mean`);
  });
});

describe('top values and shapes for all columns', () => {
  it('returns up to five values and three shapes per column', () => {
    db.run(valueCountsSql('data'));
    const top = db.rows(topValuesAllSql());
    const priority = top.filter((r) => r.column_name === 'Order Priority');
    expect(priority).toHaveLength(5);
    // Counts come back from DuckDB as BigInt.
    expect(Number(priority.find((r) => r.value === '4-Not Specified')?.n)).toBe(300);

    const shapes = db.rows(shapesAllSql()).filter((r) => r.column_name === 'Order Date');
    expect(shapes.map((r) => [r.value, Number(r.n)])).toEqual([['99/99/9999', ROWS]]);
  });
});

describe('personal data patterns', () => {
  /** Appends the correct check digit to nine digits. */
  function nhs(nine: string): string {
    for (let check = 0; check <= 9; check += 1) {
      if (isValidNhsNumber(nine + check)) return nine + check;
    }
    throw new Error(`No valid check digit for ${nine}`);
  }

  it('recognises NHS numbers by check digit, and UK postcodes, NI numbers and phone numbers', () => {
    const valid = ['943476591', '401023213', '450557710', '601234567', '712345678', '485777300'].map(nhs);
    const formatted = `${valid[0].slice(0, 3)} ${valid[0].slice(3, 6)} ${valid[0].slice(6)}`;
    const rows = [
      ['NHS Number', 'Postcode', 'NI Number', 'Phone'],
      [formatted, 'S1 2HE', 'QQ 12 34 56 C', '0114 225 5555'],
      [valid[1], 'LS1 4AB', 'AB123456D', '07700 900123'],
      [valid[2], 'M60 1NW', 'JG 10 37 48 A', '+44 20 7946 0958'],
      [valid[3], 'SW1A 1AA', 'ZZ123456A', '01632 960123'],
      [valid[4], 'P9X 1AB', 'not an NI', '02079460958'],
      ['9434765918', 'B33 8TH', 'CE 12 34 56 B', 'call me'],
    ];
    load('people', 'people.csv', rows.map((r) => r.join(',')).join('\n'));
    const f = factsFor('people');

    expect(f.get('NHS Number')).toMatchObject({ nhsShaped: 6, nhsValid: 5 });
    expect(f.get('Postcode')!.postcodes).toBe(6);
    // ZZ is not an issued prefix, so only four of the six are well-formed.
    expect(f.get('NI Number')!.niNumbers).toBe(4);
    expect(f.get('Phone')!.phones).toBe(5);
  });
});
