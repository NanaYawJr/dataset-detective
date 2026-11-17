import { describe, expect, it } from 'vitest';
import { compareProfiles } from '../compare/compare';
import type { ColumnStats, ProfileResult } from '../profile/types';
import type { ColumnDecision, ColumnFacts } from '../rules/types';
import { buildSummary, maskQuoted } from './summary';

/** Values that must never leave the browser. Each is unusual enough that finding it anywhere means a leak. */
const SECRETS = {
  topValue: 'zz-top-value-71',
  shape: 'ZZSHAPE',
  example: 'zz-example-key-55',
  newCategory: 'zz-new-category',
  oldCategory: 'zz-old-category',
  mean: 98765.4321,
  max: 55555.25,
  date: 20391231,
};

function column(name: string, decision: Partial<ColumnDecision>, extra: Partial<ColumnStats> = {}): ColumnStats {
  return {
    name,
    sqlName: name,
    filled: 100,
    empty: 0,
    distinct: 10,
    minLength: 1,
    maxLength: 9,
    topValues: [{ value: SECRETS.topValue, count: 40 }],
    shapes: [{ value: SECRETS.shape, count: 40 }],
    facts: { filled: 100, distinct: 10, placeholderValues: [SECRETS.example] } as unknown as ColumnFacts,
    decision: {
      type: 'text',
      role: 'category',
      effectivelyMissing: 0,
      findings: [
        {
          kind: 'placeholders',
          severity: 'warn',
          title: 'Placeholder values hide missing data',
          detail: `Such as "${SECRETS.example}"`,
          rows: 30,
        },
      ],
      ...decision,
    },
    ...extra,
  } as ColumnStats;
}

function profile(columns: ColumnStats[], rows = 100): ProfileResult {
  return {
    fileName: 'secret-payroll.csv',
    fileSize: 1234,
    format: {
      encoding: 'utf-8',
      delimiter: ',',
      hasHeader: true,
      lineEnding: 'LF',
      columns: [],
      sampledRows: 0,
      sampleTruncated: false,
      problems: [],
      readable: true,
    },
    source: {
      kind: 'delimited',
      label: 'Delimited text',
      facts: [],
      notes: [{ key: 'x', title: SECRETS.example, detail: SECRETS.example }],
      cards: [],
    },
    scope: 'full',
    region: 'UK',
    totalRows: rows,
    profiledRows: rows,
    skippedRows: 0,
    columns,
    table: {
      grain: null,
      coverage: [{ column: 'Paid On', months: [{ month: 203912, rows: 5 }], future: 0 }],
      findings: [
        {
          kind: 'dependency-broken',
          severity: 'warn',
          columns: ['Grade', 'Band'],
          title: '1 value of Grade map to more than one Band',
          detail: `"${SECRETS.example}" has more than one.`,
          rows: 1,
        },
      ],
    },
    overrides: {},
    profiledAt: new Date(),
    durationMs: 10,
  } as ProfileResult;
}

const now = profile([
  column('Grade', {}),
  column(
    'Salary',
    { type: 'currency', role: 'measure' },
    { measure: { min: 1, max: SECRETS.max, mean: SECRETS.mean, median: 2, std: 1 } },
  ),
  column(
    'Paid On',
    { type: 'date', role: 'date', date: { order: 'day-first', basis: 'evidence', evidence: 9 } },
    { dateRange: { first: 20250101, last: SECRETS.date } },
  ),
]);
const earlier = profile([
  column('Grade', {}),
  column('Salary', { type: 'currency', role: 'measure' }, { measure: { min: 1, max: 9, mean: 5, median: 2, std: 1 } }),
  column(
    'Paid On',
    { type: 'date', role: 'date', date: { order: 'day-first', basis: 'evidence', evidence: 9 } },
    { dateRange: { first: 20250101, last: 20250201 } },
  ),
]);
const comparison = compareProfiles(
  now,
  earlier,
  [{ column: 'Grade', added: [SECRETS.newCategory], removed: [SECRETS.oldCategory] }],
  'UK',
);

describe('buildSummary', () => {
  it('describes the shape of the data', () => {
    const summary = buildSummary(now);
    expect(summary.file).toEqual({ format: 'delimited', rows: 100, columns: 3, sampled: false });
    expect(summary.columns[2]).toEqual({
      name: 'Paid On',
      type: 'date',
      role: 'date',
      missing_share: 0,
      distinct: 10,
      date_order: 'day-first',
    });
    expect(summary.findings).toContainEqual({
      subject: 'Grade',
      severity: 'warn',
      title: 'Placeholder values hide missing data',
      rows: 30,
    });
  });

  it('never contains a value from the file, even with a comparison', () => {
    // The comparison's own text does show values to the person looking at it...
    const shown = JSON.stringify(comparison);
    expect(shown).toContain(SECRETS.newCategory);
    expect(shown).toContain('55,555.25');

    // ...but none of them, and nothing from rows, examples, shapes or notes, is in the summary.
    const sent = JSON.stringify(buildSummary(now, comparison));
    for (const secret of [
      SECRETS.topValue,
      SECRETS.shape,
      SECRETS.example,
      SECRETS.newCategory,
      SECRETS.oldCategory,
      'secret-payroll',
    ]) {
      expect(sent).not.toContain(secret);
    }
    for (const number of ['98765', '98,765', '55555', '55,555', '2039']) {
      expect(sent).not.toContain(number);
    }
    // It still says what changed.
    expect(sent).toContain('Grade: 1 new category value');
    expect(sent).toContain('Salary: the largest value more than doubled');
    expect(sent).toContain('Paid On: the latest date moved later');
  });

  it('masks anything quoted, as a second guard', () => {
    expect(maskQuoted('A new value: "On hold" and “Mail” and ‘x’')).toBe(
      'A new value: [value] and [value] and [value]',
    );
  });
});
