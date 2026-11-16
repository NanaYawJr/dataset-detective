import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { openTestDb, type TestDb } from '../profile/duckdbNode.testutil';
import { columnFactsSql, toColumnFacts, valueCountsSql } from '../profile/factsSql';
import { createTableSql, readCsvSql } from '../profile/sql';
import { decideColumns } from '../rules/decide';
import type { ColumnDecision } from '../rules/types';
import { csvLine } from './csvText';
import { declaredMismatchNote, withDeclaredNote } from './declared';
import { detectKind } from './kind';
import { declaredType } from './parquet';
import { prepareSource } from './prepare';
import type { PreparedSource } from './types';

/**
 * Each kind of file is prepared, then loaded and decided by the real
 * engine, to prove that Excel, Parquet and JSON end up as the same table
 * the CSV sample gives.
 */

const bytes = (path: string) => new Uint8Array(readFileSync(new URL(path, import.meta.url)));
const sample = (name: string) => new File([bytes(`../../../samples/${name}`)], name);
const fixture = (name: string) => new File([bytes(`./fixtures/${name}`)], name);
const text = (name: string, content: string) => new File([content], name);

let db: TestDb;
let tables = 0;

async function decide(source: PreparedSource): Promise<{ rows: number; columns: Record<string, ColumnDecision> }> {
  const table = `t${(tables += 1)}`;
  db.addFile(`${table}.csv`, await source.data.text());
  db.run(
    createTableSql(
      table,
      readCsvSql({
        fileName: `${table}.csv`,
        delimiter: ',',
        hasHeader: source.format.hasHeader,
        skipBrokenRows: false,
      }),
      false,
    ),
  );
  db.run(valueCountsSql(table));
  // As in the app: a column with no values at all has no evidence row, so it gets empty facts.
  const evidence = new Map(db.rows(columnFactsSql()).map((r) => [String(r.column_name), r]));
  const facts = db.rows(`DESCRIBE "${table}"`).map((r) => {
    const name = String(r.column_name);
    return { name, facts: toColumnFacts(evidence.get(name) ?? { filled: 0, distinct_values: 0 }) };
  });
  const [{ n }] = db.rows(`SELECT count(*) AS n FROM "${table}"`);
  const decided = decideColumns(facts, Number(n), 'UK');
  return { rows: Number(n), columns: Object.fromEntries(decided.map((c) => [c.name, c.decision])) };
}

beforeAll(async () => {
  db = await openTestDb();
});

describe('detectKind', () => {
  const head = (...codes: number[]) => new Uint8Array(codes);
  it('goes by the first bytes, then the name', () => {
    expect(detectKind('data.csv', head(0x50, 0x4b, 0x03, 0x04))).toBe('excel');
    expect(detectKind('data.bin', head(0x50, 0x41, 0x52, 0x31))).toBe('parquet');
    expect(detectKind('old.xls', head(0xd0, 0xcf, 0x11, 0xe0))).toBe('legacy-excel');
    expect(detectKind('events.ndjson', head(0x7b))).toBe('json');
    expect(detectKind('export.txt', head(0x61))).toBe('delimited');
  });
});

describe('csvLine', () => {
  it('quotes only what needs it', () => {
    expect(csvLine(['a', 'b c', 'd,e', 'say "hi"', ' padded', 'two\nlines'])).toBe(
      'a,b c,"d,e","say ""hi"""," padded","two\nlines"\n',
    );
    expect(csvLine([''])).toBe('""\n');
  });
});

describe('Excel workbook', () => {
  it('finds the table under the title and reads real dates', async () => {
    const source = await prepareSource(sample('sales-sample.xlsx'));
    expect(source.details).toMatchObject({ kind: 'excel', sheetIndex: 0 });
    expect(source.details.facts).toEqual(['sheet "Orders"', 'header on row 4']);
    expect(source.details.sheets?.map((s) => s.name)).toEqual(['Orders', 'Regions']);
    expect(source.details.notes.map((n) => n.key)).toEqual(['rows-above-header', 'excel-dates', 'merged-cells']);
    expect(source.format.columns).toHaveLength(12);

    const { rows, columns } = await decide(source);
    expect(rows).toBe(1378);
    expect(columns['Order Date']).toMatchObject({ type: 'date', date: { order: 'year-first', basis: 'iso' } });
    expect(columns['Order ID'].role).toBe('identifier');
    expect(columns['Unit Price'].type).toBe('decimal');
    expect(columns['Discount'].type).toBe('percent');
  });

  it('reads the sheet that was asked for', async () => {
    const source = await prepareSource(sample('sales-sample.xlsx'), { sheet: 1 });
    expect(source.format.columns).toEqual(['City', 'Region']);
    expect((await decide(source)).rows).toBe(12);
  });

  it('skips a sheet of notes, and reports formulas with no result and hidden sheets', async () => {
    const source = await prepareSource(fixture('openpyxl.xlsx'));
    expect(source.details.facts).toEqual(['sheet "Visits"', 'header on row 3']);
    expect(source.details.notes.map((n) => n.key)).toEqual([
      'rows-above-header',
      'excel-dates',
      'formulas-without-result',
      'merged-cells',
      'hidden-sheets',
    ]);
    const { columns } = await decide(source);
    expect(columns.Cost.role).toBe('empty');
    expect(columns.Seen.type).toBe('date');
  });

  it('explains files it cannot read', async () => {
    const legacy = await prepareSource(new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0])], 'old.xls'));
    expect(legacy.format.readable).toBe(false);
    expect(legacy.format.problems[0]).toMatchObject({ kind: 'cannot-read' });

    const zip = await prepareSource(new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4])], 'photos.zip'));
    expect(zip.format.problems[0]).toMatchObject({ title: "This zip file isn't an Excel workbook" });
  });
});

describe('Parquet file', () => {
  it('gives the same table as the CSV sample, with declared types reported', async () => {
    const source = await prepareSource(sample('sales-sample.parquet'));
    expect(source.details.kind).toBe('parquet');
    expect(source.details.cards[1]).toMatchObject({ label: 'Declared types', value: '12 typed' });
    expect(source.details.cards[1].hint).toBe('5 text, 3 decimal, 2 whole number, 2 date');

    const { rows, columns } = await decide(source);
    expect(rows).toBe(1378);
    expect(columns['Order Date']).toMatchObject({ type: 'date', date: { order: 'year-first' } });
    expect(columns['Order ID'].role).toBe('identifier');
    expect(columns['Customer Email'].role).toBe('personal');
  });

  it('reads every kind of column, written by another program with other compression', async () => {
    const source = await prepareSource(fixture('types.parquet'));
    const lines = (await source.data.text()).split('\n');
    expect(lines[0]).toBe('id,big,ratio,amount,flag,day,seen_at,label,day_as_text,price_as_text,code,tags,point');
    expect(lines[1]).toBe(
      '1,1000000007,0.25,1.25,false,2025-01-02,2025-01-01 09:30:00,name 1,2025-03-02,12.50,00001,"[1,2]","{""x"":1,""y"":""p1""}"',
    );
    expect(lines[5]).toContain(',2025-01-06,2025-01-01 13:30:00,,');
    expect(source.details.notes.map((n) => n.key)).toEqual(['declared-types', 'nested-columns']);

    const { columns } = await decide(source);
    expect(columns.day.type).toBe('date');
    expect(columns.seen_at.type).toBe('date');
    expect(columns.amount.type).toBe('decimal');
  });

  it('flags columns declared as text that hold dates or numbers, but not codes', async () => {
    const source = await prepareSource(fixture('types.parquet'));
    const { columns } = await decide(source);
    const decided = Object.entries(columns).map(([name, decision]) => ({ name, decision }));
    const note = declaredMismatchNote(source.details.declaredTypes ?? {}, decided);
    expect(note?.title).toBe('2 columns are declared as text but hold dates or numbers');
    expect(note?.detail).toContain('"day_as_text" holds dates, "price_as_text" holds numbers.');
    // 00001 is a code, and text is the right type for it.
    expect(note?.detail).not.toContain('code');

    const details = withDeclaredNote(source.details, decided);
    expect(details.notes.map((n) => n.key)).toEqual(['declared-types', 'nested-columns', 'declared-mismatch']);
    // Applying it again replaces the note rather than repeating it.
    expect(withDeclaredNote(details, decided).notes).toHaveLength(3);
    expect(withDeclaredNote(details, []).notes).toHaveLength(2);
  });

  it('names declared types in plain words', () => {
    expect(declaredType({ name: 'a', type: 'BYTE_ARRAY', converted_type: 'UTF8' })).toBe('text');
    expect(declaredType({ name: 'a', type: 'INT32', converted_type: 'DATE' })).toBe('date');
    expect(declaredType({ name: 'a', type: 'INT96' })).toBe('date and time');
    expect(declaredType({ name: 'a', type: 'BOOLEAN' })).toBe('true/false');
    expect(declaredType({ name: 'a', num_children: 2 })).toBe('nested record');
  });

  it('explains a damaged file', async () => {
    const source = await prepareSource(new File([new Uint8Array([0x50, 0x41, 0x52, 0x31, 9, 9, 9, 9])], 'cut.parquet'));
    expect(source.format.problems[0]).toMatchObject({
      kind: 'cannot-read',
      title: "This Parquet file couldn't be read",
    });
  });
});

describe('JSON file', () => {
  it('becomes a table the engine reads like any other', async () => {
    const records = Array.from({ length: 40 }, (_, i) => ({
      id: i + 1,
      seen: `2026-02-${String((i % 28) + 1).padStart(2, '0')}`,
      customer: { email: `person${i}@example.com`, city: i % 2 ? 'Leeds' : 'York' },
      note: i === 3 ? 'said "ok", then left' : 'fine',
    }));
    const source = await prepareSource(text('visits.json', JSON.stringify({ count: 40, data: records })));
    expect(source.details.facts).toEqual(['records under "data"']);
    expect(source.details.notes.map((n) => n.key)).toEqual(['list-under-key', 'nested-objects']);
    expect(source.format.columns).toEqual(['id', 'seen', 'customer.email', 'customer.city', 'note']);

    const { rows, columns } = await decide(source);
    expect(rows).toBe(40);
    expect(columns.id.role).toBe('identifier');
    expect(columns.seen.type).toBe('date');
    expect(columns['customer.email'].role).toBe('personal');
  });

  it('explains files it cannot use', async () => {
    const broken = await prepareSource(text('cut.json', '[{"a":1},'));
    expect(broken.format.problems[0]).toMatchObject({ title: "This isn't valid JSON" });
    const single = await prepareSource(text('config.json', '{"name":"x"}'));
    expect(single.format.problems[0]).toMatchObject({ title: 'No list of records was found' });
  });
});

describe('delimited text', () => {
  it('is passed through untouched', async () => {
    const file = sample('sales-sample.csv');
    const source = await prepareSource(file);
    expect(source.details.kind).toBe('delimited');
    expect(source.data).toBe(file);
    expect(source.format).toMatchObject({ delimiter: ',', hasHeader: true, readable: true });
  });
});
