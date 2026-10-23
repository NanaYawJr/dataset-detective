import { describe, expect, it } from 'vitest';
import { createTableSql, quoteIdent, quoteLiteral, readCsvSql } from './sql';

describe('quoting', () => {
  it('escapes double quotes in identifiers', () => {
    expect(quoteIdent('City | Region')).toBe('"City | Region"');
    expect(quoteIdent('say "hi"')).toBe('"say ""hi"""');
  });

  it('escapes single quotes in literals', () => {
    expect(quoteLiteral("O'Neill")).toBe("'O''Neill'");
  });
});

describe('readCsvSql', () => {
  const base = { fileName: 'input.csv', delimiter: ',' as const, hasHeader: true, skipBrokenRows: false };

  it('reads every column as text with the detected delimiter and header', () => {
    const sql = readCsvSql(base);
    expect(sql).toContain("delim = ','");
    expect(sql).toContain('header = true');
    expect(sql).toContain('all_varchar = true');
    expect(sql).not.toContain('ignore_errors');
  });

  it('quotes a tab delimiter safely', () => {
    expect(readCsvSql({ ...base, delimiter: '\t' })).toContain("delim = '\t'");
  });

  it('skips and records broken rows only when asked', () => {
    const skipping = readCsvSql({ ...base, skipBrokenRows: true, recordRejects: true });
    expect(skipping).toContain('ignore_errors = true');
    expect(skipping).toContain('store_rejects = true');
    expect(readCsvSql({ ...base, skipBrokenRows: true })).not.toContain('store_rejects');
  });
});

describe('createTableSql', () => {
  it('uses a repeatable reservoir sample for quick mode', () => {
    expect(createTableSql('data', 'src', true)).toBe(
      'CREATE OR REPLACE TABLE "data" AS SELECT * FROM src USING SAMPLE reservoir(100000 ROWS) REPEATABLE (42)',
    );
    expect(createTableSql('data', 'src', false)).toBe('CREATE OR REPLACE TABLE "data" AS SELECT * FROM src');
  });
});
