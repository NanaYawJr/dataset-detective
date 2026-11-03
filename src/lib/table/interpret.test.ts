import { describe, expect, it } from 'vitest';
import { fillMonths, formatMonth, interpretTable, missingMonths } from './interpret';
import type { TableResults } from './types';

const base: TableResults = {
  rows: 1000,
  duplicateRows: 0,
  singleKeys: [],
  pairKey: null,
  pairsChecked: 0,
  dependencies: [],
  datePairs: [],
  coverage: [],
};
const run = (changes: Partial<TableResults>, sampled = false) =>
  interpretTable({ ...base, ...changes }, { sampled, region: 'UK' }).findings;

describe('months', () => {
  it('finds months with no rows between the first and last', () => {
    expect(
      missingMonths([
        { month: 202511, rows: 3 },
        { month: 202602, rows: 1 },
      ]),
    ).toEqual([202512, 202601]);
    expect(missingMonths([])).toEqual([]);
  });

  it('writes months without ambiguity for each region', () => {
    expect(formatMonth(202507, 'UK')).toBe('Jul 2025');
    expect(formatMonth(202507, 'CA')).toBe('2025-07');
  });
});

describe('interpretTable', () => {
  it('marks duplicates as high from 1% of rows and mentions sampling', () => {
    const [low] = run({ duplicateRows: 5 });
    expect(low).toMatchObject({ kind: 'duplicate-rows', severity: 'warn', rows: 5 });
    const [high] = run({ duplicateRows: 10 }, true);
    expect(high.severity).toBe('high');
    expect(high.detail).toContain('in the sampled rows');
  });

  it('describes the grain from a key, and says when there is none', () => {
    expect(interpretTable({ ...base, singleKeys: ['Order ID'] }, { sampled: false, region: 'UK' }).grain).toBe(
      'Each row is one Order ID',
    );
    expect(run({ pairsChecked: 6 })[0]).toMatchObject({ kind: 'no-key' });
    expect(run({})).toEqual([]);
  });

  it('only notes dependencies that mean something', () => {
    const dep = { from: 'City', to: 'Region', keys: 12, repeated: 12, violating: 0, examples: [], toDistinct: 9 };
    expect(run({ dependencies: [dep] })[0].title).toBe('Each City has exactly one Region');
    // One-to-one, or a "to" side with a single value, says nothing useful.
    expect(run({ dependencies: [{ ...dep, toDistinct: 12 }] })).toEqual([]);
    expect(run({ dependencies: [{ ...dep, toDistinct: 1 }] })).toEqual([]);
  });

  it('flags a dependency that almost holds, and ignores one that mostly fails', () => {
    const dep = {
      from: 'Code',
      to: 'Name',
      keys: 200,
      repeated: 180,
      violating: 3,
      examples: ['A1', 'B2', 'C3'],
      toDistinct: 150,
    };
    const [broken] = run({ dependencies: [dep] });
    expect(broken).toMatchObject({ kind: 'dependency-broken', severity: 'warn', rows: 3 });
    expect(broken.detail).toContain('"A1", "B2" and "C3" have more than one');
    expect(run({ dependencies: [{ ...dep, violating: 120 }] })).toEqual([]);
    // Mostly one-off values prove nothing either way.
    expect(run({ dependencies: [{ ...dep, repeated: 40 }] })).toEqual([]);
  });

  it('works out which date usually comes first', () => {
    const pair = { a: 'Ship Date', b: 'Order Date', both: 500, aBeforeB: 4, bBeforeA: 480 };
    const [f] = run({ datePairs: [pair] });
    expect(f).toMatchObject({ kind: 'event-order-broken', columns: ['Order Date', 'Ship Date'], rows: 4 });
    expect(run({ datePairs: [{ ...pair, aBeforeB: 0 }] })[0]).toMatchObject({ kind: 'event-order' });
    expect(run({ datePairs: [{ ...pair, aBeforeB: 200, bBeforeA: 250 }] })).toEqual([]);
  });

  it('ignores gaps in sparse dates', () => {
    const months = [
      { month: 202501, rows: 2 },
      { month: 202506, rows: 1 },
    ];
    expect(run({ coverage: [{ column: 'Seen', months, future: 0 }] })).toEqual([]);
  });
});

describe('fillMonths', () => {
  it('fills empty months across a year end with zero', () => {
    expect(
      fillMonths([
        { month: 202511, rows: 3 },
        { month: 202602, rows: 1 },
      ]),
    ).toEqual([
      { month: 202511, rows: 3 },
      { month: 202512, rows: 0 },
      { month: 202601, rows: 0 },
      { month: 202602, rows: 1 },
    ]);
  });
});
