import { describe, expect, it } from 'vitest';
import type { ColumnDecision, ColumnFacts } from '../rules/types';
import { planTableChecks } from './plan';
import type { TableColumn } from './types';

function column(name: string, decision: Partial<ColumnDecision>, facts: Partial<ColumnFacts>): TableColumn {
  return {
    name,
    sqlName: name,
    facts: { filled: 100, distinct: 10, ...facts } as ColumnFacts,
    decision: { type: 'text', role: 'category', effectivelyMissing: 0, findings: [], ...decision },
  };
}

describe('planTableChecks', () => {
  it('skips the pair search when one column is already a key', () => {
    const plan = planTableChecks(
      [column('Id', { type: 'integer', role: 'identifier' }, { distinct: 100 }), column('Status', {}, { distinct: 3 })],
      100,
    );
    expect(plan.keyPairs).toEqual([]);
  });

  it('pairs candidate key columns when no single column is a key', () => {
    const plan = planTableChecks(
      [
        column('Store', {}, { distinct: 3 }),
        column('Day', { type: 'date', role: 'date', date: { order: 'year-first', basis: 'iso', evidence: 100 } }, {}),
        column('Sales', { type: 'integer', role: 'measure' }, { distinct: 90 }),
      ],
      100,
    );
    expect(plan.keyPairs.map(([a, b]) => [a.label, b.label])).toEqual([['Day', 'Store']]);
  });

  it('tests the two parts of a packed column against each other', () => {
    const plan = planTableChecks(
      [column('City | Region', { packed: { separator: '|', parts: ['City', 'Region'] } }, { distinct: 80 })],
      100,
    );
    const [[city, region]] = plan.dependencyPairs;
    expect(city).toMatchObject({ label: 'City', within: 'City | Region' });
    expect(region.sql).toBe(`nullif(trim(split_part("City | Region", '|', 2)), '')`);
  });

  it('leaves out empty, constant and near-unique columns', () => {
    const plan = planTableChecks(
      [
        column('Blank', { role: 'empty' }, { filled: 0, distinct: 0 }),
        column('Same', { role: 'constant' }, { distinct: 1 }),
        column('Notes', { role: 'free-text' }, { distinct: 95 }),
        column('A', {}, { distinct: 4 }),
        column('B', {}, { distinct: 6 }),
      ],
      100,
    );
    expect(plan.dependencyPairs.map(([a, b]) => `${a.label}~${b.label}`)).toEqual(['A~B']);
  });

  it('only checks dates whose order is decided', () => {
    const date = (name: string, order: 'day-first' | null) =>
      column(
        name,
        { type: 'date', role: 'date', date: { order, basis: order ? 'evidence' : 'unresolved', evidence: 0 } },
        {},
      );
    const plan = planTableChecks([date('Ordered', 'day-first'), date('Shipped', 'day-first'), date('Seen', null)], 100);
    expect(plan.coverage.map((c) => c.label)).toEqual(['Ordered', 'Shipped']);
    expect(plan.datePairs).toHaveLength(1);
  });
});
