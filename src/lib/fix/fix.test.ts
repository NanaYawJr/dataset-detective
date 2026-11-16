import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { openTestDb, type TestDb } from '../profile/duckdbNode.testutil';
import type { ColumnDecision, ColumnFacts } from '../rules/types';
import { prepareSource } from '../source/prepare';
import { toPandas } from './pandas';
import { buildFixPlan, slug, type FixPlan, type PlanColumn, type PlanSource } from './plan';
import { toPowerQuery } from './powerQuery';
import { planForTest } from './profile.testutil';
import { toTsql } from './tsql';

const sampleFile = (name: string) => new File([new Uint8Array(readFileSync(`samples/${name}`))], name);

const CSV: PlanSource = {
  kind: 'delimited',
  fileName: 'orders.csv',
  delimiter: ',',
  encoding: 'utf-8',
  hasHeader: true,
};

function column(name: string, decision: Partial<ColumnDecision>, facts: Partial<ColumnFacts> = {}): PlanColumn {
  return {
    name,
    facts: { placeholderValues: [], leadingZeros: 0, thousands: 0, ...facts } as ColumnFacts,
    decision: { type: 'text', role: 'category', effectivelyMissing: 0, findings: [], ...decision },
  };
}

describe('buildFixPlan', () => {
  it('converts numbers and dates, and says what it leaves alone and why', () => {
    const plan = buildFixPlan(
      CSV,
      [
        column('Price', { type: 'currency', role: 'measure' }, { thousands: 3 }),
        column('Account', { type: 'integer', role: 'identifier' }, { leadingZeros: 40 }),
        column('Seen', { type: 'date', role: 'date', date: { order: null, basis: 'unresolved', evidence: 0 } }),
        column('Blank', { type: 'empty', role: 'empty' }),
      ],
      0,
    );
    expect(plan.columns[0].steps).toEqual([
      { kind: 'number', remove: ['£', '$', '€', ','], percent: false, whole: false },
    ]);
    expect(plan.columns[1]).toMatchObject({ target: 'text', steps: [] });
    expect(plan.columns[2].steps).toEqual([]);
    expect(plan.columns[3].steps).toEqual([{ kind: 'drop' }]);
    expect(plan.leftAlone[0]).toContain('Account stays as text');
    expect(plan.leftAlone[1]).toContain('Seen stays as text');
    expect(plan.summary).toContain('Remove the empty column: Blank.');
  });

  it('makes names that are safe for tables and files', () => {
    expect(slug('Sales Extract (Q3).csv')).toBe('sales_extract_q3');
    expect(slug('2025-orders.xlsx')).toBe('file_2025_orders');
  });

  it('escapes awkward names and values in every language', () => {
    const plan = buildFixPlan(
      CSV,
      [column(`He said "ok" [x]`, { type: 'text' }, { placeholderValues: [`N/A's "none"`] })],
      2,
    );
    expect(toPandas(plan)).toContain(String.raw`df["He said \"ok\" [x]"].isin(["N/A's \"none\""])`);
    expect(toTsql(plan)).toContain(`s.[He said "ok" [x]]]`);
    expect(toTsql(plan)).toContain(`IN (N'N/A''s "none"')`);
    expect(toTsql(plan)).toContain('SELECT DISTINCT');
    expect(toPowerQuery(plan)).toContain(
      `{"He said ""ok"" [x]", each if _ is text and List.Contains({"N/A's ""none"""}, _)`,
    );
    expect(toPowerQuery(plan)).toContain('Table.Distinct(');
  });
});

describe('the sales sample', () => {
  let db: TestDb;
  let plan: FixPlan;
  beforeAll(async () => {
    db = await openTestDb();
    plan = await planForTest(db, 'sales-sample.csv', await prepareSource(sampleFile('sales-sample.csv')));
  });

  it('plans a fix for each deliberate problem', () => {
    expect(plan.summary).toEqual([
      'Read the file with every column as text, so nothing is converted by guesswork.',
      'Turn placeholder values into real blanks in Order Priority.',
      'Convert percentages stored as text to numbers in Discount: "5%" becomes 0.05.',
      'Set number types for Order ID, Order Quantity, Unit Price and 1 more.',
      'Read Order Date, Ship Date as day-first dates.',
      'Split City | Region into City and Region.',
      'Add Order Priority Rank, the number at the start of Order Priority, so it sorts in the right order.',
    ]);
    expect(plan.leftAlone).toEqual([]);
  });

  it('writes T-SQL that converts safely', () => {
    const sql = toTsql(plan);
    expect(sql).toContain('TRY_CONVERT(date, c.[Order Date], 103) AS [Order Date]');
    expect(sql).toContain(`TRY_CONVERT(decimal(18, 4), REPLACE(c.[Discount], N'%', N'')) / 100 AS [Discount]`);
    expect(sql).toContain(`CASE WHEN LTRIM(RTRIM(s.[Order Priority])) IN (N'4-Not Specified') THEN NULL`);
    expect(sql).toContain('AS [City],');
    expect(sql).toContain('FROM dbo.sales_sample_staging AS s');
    // Every bracket and quote is closed.
    expect(sql.split('(').length).toBe(sql.split(')').length);
  });

  it('writes Power Query that reads dates with the proven culture', () => {
    const pq = toPowerQuery(plan);
    expect(pq).toContain(
      'Csv.Document(File.Contents(FilePath), [Delimiter = ",", Encoding = 65001, QuoteStyle = QuoteStyle.Csv])',
    );
    expect(pq).toContain('{"Order Date", each ToDate(_, "en-GB"), type nullable date}');
    expect(pq).toContain('{"Discount", each ToNumber(_, {"%"}, 100), type nullable number}');
    expect(pq).toContain('Table.SplitColumn(Ranked1, "City | Region"');
    expect(pq.trimEnd().endsWith('in\n    Result')).toBe(true);
    // Each step feeds the next: every step name except the last is used by a later step.
    const steps = [...pq.matchAll(/^ {4}([A-Z][A-Za-z0-9]*) = /gm)].map((match) => match[1]);
    expect(new Set(steps).size).toBe(steps.length);
    expect(pq.split('(').length).toBe(pq.split(')').length);
    expect(pq.split('{').length).toBe(pq.split('}').length);
  });

  it('adapts the reading step to Excel and Parquet', async () => {
    const excel = await planForTest(db, 'sales-sample.xlsx', await prepareSource(sampleFile('sales-sample.xlsx')));
    expect(toPowerQuery(excel)).toContain('Workbook{[Item = "Orders", Kind = "Sheet"]}[Data]');
    expect(toPowerQuery(excel)).toContain('Table.Skip(Sheet, each not List.Contains(Record.ToList(_), "Order ID"))');
    expect(toPandas(excel)).toContain('pd.read_excel(SOURCE, sheet_name="Orders", header=3, dtype="string")');

    const parquet = await planForTest(
      db,
      'sales-sample.parquet',
      await prepareSource(sampleFile('sales-sample.parquet')),
    );
    expect(toPowerQuery(parquet)).toContain('Parquet.Document(File.Contents(FilePath))');
    expect(toPandas(parquet)).toContain('df = pd.read_parquet(SOURCE)');
  });
});

/**
 * The strongest check: run the generated pandas script for real and look
 * at what comes out. It needs Python with pandas, so it is skipped where
 * that isn't installed (CI installs it).
 */
function pythonWith(...modules: string[]): boolean {
  try {
    execFileSync('python3', ['-c', `import ${modules.join(', ')}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function runScript(script: string, sample: string): Record<string, unknown> {
  const dir = mkdtempSync(join(tmpdir(), 'fix-'));
  copyFileSync(`samples/${sample}`, join(dir, sample));
  const check = `
import json
print("RESULT " + json.dumps({
    "rows": len(df),
    "columns": list(df.columns),
    "kinds": {name: df[name].dtype.kind for name in df.columns},
    "discount": [float(v) for v in df["Discount"].head(2)],
    "first_order": str(df["Order Date"].iloc[0])[:10],
    "blank_priorities": int(df["Order Priority"].isna().sum()),
    "ranks": sorted(int(v) for v in df["Order Priority Rank"].dropna().unique()),
    "cities": int(df["City"].nunique()),
    "shipped_before_ordered": int((df["Ship Date"] < df["Order Date"]).sum()),
}))
`;
  writeFileSync(join(dir, 'clean.py'), script + check);
  const output = execFileSync('python3', ['clean.py'], { cwd: dir, encoding: 'utf8' });
  return JSON.parse(output.split('RESULT ')[1]) as Record<string, unknown>;
}

describe.skipIf(!pythonWith('pandas'))('the generated pandas script, run for real', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await openTestDb();
  });

  const expected = {
    rows: 1378,
    discount: [0.04, 0.08],
    first_order: '2025-01-28',
    blank_priorities: 300,
    ranks: [1, 2, 3, 5],
    cities: 12,
    shipped_before_ordered: 4,
  };

  it('cleans the CSV sample', async () => {
    const plan = await planForTest(db, 'sales-sample.csv', await prepareSource(sampleFile('sales-sample.csv')));
    const result = runScript(toPandas(plan), 'sales-sample.csv');
    expect(result).toMatchObject(expected);
    expect(result.columns).toEqual([
      'Order ID',
      'Order Date',
      'Ship Date',
      'Order Priority',
      'Order Quantity',
      'Discount',
      'Unit Price',
      'Profit',
      'Ship Mode',
      'Customer Segment',
      'Customer Email',
      'Order Priority Rank',
      'City',
      'Region',
    ]);
    // i = whole number, f = decimal, M = date.
    expect(result.kinds).toMatchObject({
      'Order ID': 'i',
      Discount: 'f',
      'Order Date': 'M',
      'Order Priority Rank': 'i',
    });
  });

  it.skipIf(!pythonWith('pandas', 'openpyxl'))('cleans the Excel sample to the same result', async () => {
    const plan = await planForTest(db, 'sales-sample.xlsx', await prepareSource(sampleFile('sales-sample.xlsx')));
    expect(runScript(toPandas(plan), 'sales-sample.xlsx')).toMatchObject(expected);
  });

  it.skipIf(!pythonWith('pandas', 'pyarrow'))('cleans the Parquet sample to the same result', async () => {
    const plan = await planForTest(db, 'sales-sample.parquet', await prepareSource(sampleFile('sales-sample.parquet')));
    expect(runScript(toPandas(plan), 'sales-sample.parquet')).toMatchObject(expected);
  });
});
