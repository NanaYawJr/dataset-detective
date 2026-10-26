import { describe, expect, it } from 'vitest';
import { decideColumn, decideColumns, decideDateOrder, rankFindings } from './decide';
import type { ColumnFacts } from './types';

/** Facts for a column of `filled` non-blank values; override what the test needs. */
function facts(filled: number, overrides: Partial<ColumnFacts> = {}): ColumnFacts {
  return {
    filled,
    distinct: filled,
    minLength: 1,
    maxLength: 10,
    withSpaces: 0,
    integers: 0,
    plainNumbers: 0,
    numberLike: 0,
    percents: 0,
    currency: 0,
    thousands: 0,
    leadingZeros: 0,
    slashDates: 0,
    firstPartOver12: 0,
    secondPartOver12: 0,
    impossibleSlashDates: 0,
    shortYearDates: 0,
    isoDates: 0,
    pipePairs: 0,
    semicolonPairs: 0,
    slashPairs: 0,
    placeholders: 0,
    placeholderValues: [],
    numberedLabels: 0,
    emails: 0,
    postcodes: 0,
    niNumbers: 0,
    phones: 0,
    nhsShaped: 0,
    nhsValid: 0,
    ...overrides,
  };
}

const kinds = (decision: { findings: { kind: string }[] }) => decision.findings.map((f) => f.kind);

describe('numbers', () => {
  it('treats percentages written as text as a measure with a high finding', () => {
    const d = decideColumn('Discount', facts(100, { distinct: 11, numberLike: 100, percents: 100 }), 100, 'UK');
    expect(d).toMatchObject({ type: 'percent', role: 'measure' });
    expect(d.findings[0]).toMatchObject({ kind: 'numbers-as-text', severity: 'high' });
  });

  it('separates whole numbers from decimals', () => {
    const whole = facts(100, { distinct: 50, integers: 100, plainNumbers: 100, numberLike: 100 });
    const decimal = facts(100, { integers: 10, plainNumbers: 100, numberLike: 100 });
    expect(decideColumn('Qty', whole, 100, 'UK').type).toBe('integer');
    expect(decideColumn('Price', decimal, 100, 'UK').type).toBe('decimal');
  });

  it('counts stray non-numbers in an otherwise numeric column', () => {
    const d = decideColumn('Amount', facts(100, { integers: 97, plainNumbers: 97, numberLike: 97 }), 100, 'UK');
    expect(d.findings).toContainEqual(expect.objectContaining({ kind: 'non-numeric-values', rows: 3 }));
  });

  it('keeps codes with leading zeros as text', () => {
    const d = decideColumn(
      'Account',
      facts(100, { integers: 100, plainNumbers: 100, numberLike: 100, leadingZeros: 40 }),
      100,
      'UK',
    );
    expect(d.type).toBe('text');
    expect(kinds(d)).toContain('leading-zeros');
  });

  it('treats a small set of whole numbers as categories, not measures', () => {
    const d = decideColumn(
      'Rating',
      facts(100, { distinct: 5, integers: 100, plainNumbers: 100, numberLike: 100 }),
      100,
      'UK',
    );
    expect(d.role).toBe('category');
  });
});

describe('identifiers', () => {
  it('recognises an ID by name and flags repeats', () => {
    const d = decideColumn(
      'Order ID',
      facts(1378, { distinct: 800, integers: 1378, plainNumbers: 1378, numberLike: 1378 }),
      1378,
      'UK',
    );
    expect(d.role).toBe('identifier');
    expect(d.findings).toContainEqual(expect.objectContaining({ kind: 'not-unique', rows: 578 }));
  });

  it('recognises an unnamed column of unique codes', () => {
    const d = decideColumn('Ref', facts(500), 500, 'UK');
    expect(d.role).toBe('identifier');
    expect(kinds(d)).not.toContain('not-unique');
  });

  it('accepts camelCase IDs but not words that merely end in "id"', () => {
    const repeated = (name: string) =>
      decideColumn(name, facts(100, { distinct: 60, integers: 100, plainNumbers: 100, numberLike: 100 }), 100, 'UK')
        .role;
    expect(repeated('customerId')).toBe('identifier');
    expect(repeated('Paid')).toBe('measure');
    expect(repeated('Valid')).toBe('measure');
  });

  it('does not call free text an identifier just because it is unique', () => {
    const d = decideColumn('Comment', facts(500, { withSpaces: 480 }), 500, 'UK');
    expect(d.role).toBe('free-text');
  });
});

describe('date order', () => {
  const slash = (overrides: Partial<ColumnFacts>) => facts(100, { slashDates: 100, ...overrides });

  it('is proven day-first when a first part is above 12', () => {
    expect(decideDateOrder(slash({ firstPartOver12: 40 }), 'US')).toEqual({
      order: 'day-first',
      basis: 'evidence',
      evidence: 40,
    });
  });

  it('is proven month-first when a second part is above 12', () => {
    expect(decideDateOrder(slash({ secondPartOver12: 7 }), 'UK')).toEqual({
      order: 'month-first',
      basis: 'evidence',
      evidence: 7,
    });
  });

  it('is a conflict when both orders are proven', () => {
    const d = decideColumn('When', slash({ firstPartOver12: 30, secondPartOver12: 5 }), 100, 'UK');
    expect(d.date).toMatchObject({ order: null, basis: 'conflicting' });
    expect(d.findings[0]).toMatchObject({ kind: 'date-order-conflict', severity: 'high' });
  });

  it('only suggests an unproven order, using the region', () => {
    expect(decideDateOrder(slash({}), 'UK')).toMatchObject({ order: 'day-first', basis: 'region-suggestion' });
    expect(decideDateOrder(slash({}), 'US')).toMatchObject({ order: 'month-first', basis: 'region-suggestion' });
  });

  it('makes no suggestion for Canada, where both orders are common', () => {
    expect(decideDateOrder(slash({}), 'CA')).toMatchObject({ order: null, basis: 'unresolved' });
    const d = decideColumn('When', slash({}), 100, 'CA');
    expect(d.findings[0].detail).toContain('In Canada both orders are common');
  });

  it('reads ISO dates as year-first without needing evidence', () => {
    expect(decideDateOrder(facts(100, { isoDates: 100 }), 'US')).toMatchObject({ order: 'year-first', basis: 'iso' });
  });

  it('flags values that cannot be dates in any order', () => {
    const d = decideColumn('When', slash({ firstPartOver12: 10, impossibleSlashDates: 2 }), 100, 'UK');
    expect(d.findings).toContainEqual(expect.objectContaining({ kind: 'impossible-dates', rows: 2 }));
  });

  it('lets a proven column settle the order for an unproven one in the same file', () => {
    const [start, end] = decideColumns(
      [
        { name: 'REPORTING_PERIOD_START', facts: facts(10, { distinct: 1, slashDates: 10 }) },
        { name: 'REPORTING_PERIOD_END', facts: facts(10, { distinct: 1, slashDates: 10, firstPartOver12: 10 }) },
      ],
      10,
      'US',
    );
    expect(end.decision.date).toMatchObject({ order: 'day-first', basis: 'evidence' });
    expect(start.decision.date).toEqual({
      order: 'day-first',
      basis: 'other-column',
      evidence: 0,
      source: 'REPORTING_PERIOD_END',
    });
    expect(kinds(start.decision)).toContain('date-order-inferred');
    expect(kinds(start.decision)).not.toContain('date-order-unproven');
  });

  it('does not borrow an order when another column contradicts it', () => {
    const decided = decideColumns(
      [
        { name: 'A', facts: facts(10, { slashDates: 10 }) },
        { name: 'B', facts: facts(10, { slashDates: 10, firstPartOver12: 3 }) },
        { name: 'C', facts: facts(10, { slashDates: 10, secondPartOver12: 3 }) },
      ],
      10,
      'UK',
    );
    expect(decided[0].decision.date?.basis).toBe('region-suggestion');
  });
});

describe('text checks', () => {
  it('finds two fields packed into one column and names the parts from the header', () => {
    const d = decideColumn('City | Region', facts(100, { distinct: 12, withSpaces: 100, pipePairs: 100 }), 100, 'UK');
    expect(d.packed).toEqual({ separator: '|', parts: ['City', 'Region'] });
    expect(kinds(d)).toContain('packed-field');
  });

  it('counts placeholders as missing and names them', () => {
    const d = decideColumn(
      'Order Priority',
      facts(1378, {
        distinct: 5,
        withSpaces: 300,
        numberedLabels: 1378,
        placeholders: 300,
        placeholderValues: ['4-Not Specified'],
      }),
      1378,
      'UK',
    );
    expect(d.effectivelyMissing).toBe(300);
    const placeholder = d.findings.find((f) => f.kind === 'placeholders');
    expect(placeholder?.detail).toBe(
      '"4-Not Specified" stands in for a missing value in 300 rows (22%), so the blank count understates what is missing.',
    );
    expect(kinds(d)).toContain('rank-in-text');
  });

  it('notes a column with the same value in every row', () => {
    const d = decideColumn('Period', facts(50, { distinct: 1 }), 50, 'UK');
    expect(d.role).toBe('constant');
  });

  it('flags an empty column and a mostly missing one', () => {
    expect(decideColumn('Notes', facts(0), 100, 'UK')).toMatchObject({ type: 'empty', role: 'empty' });
    expect(kinds(decideColumn('Notes', facts(30, { withSpaces: 30 }), 100, 'UK'))).toContain('mostly-blank');
  });
});

describe('personal data', () => {
  it.each([
    ['Contact', { emails: 95 }, 'email'],
    ['Patient', { nhsShaped: 100, nhsValid: 100, integers: 100, plainNumbers: 100, numberLike: 100 }, 'nhs-number'],
    ['NI', { niNumbers: 90 }, 'national-insurance'],
    ['Home', { postcodes: 100, withSpaces: 100 }, 'postcode'],
  ] as const)('%s with %j is %s', (name, overrides, kind) => {
    const d = decideColumn(name, facts(100, overrides), 100, 'UK');
    expect(d.personal).toBe(kind);
    expect(d.role).toBe('personal');
  });

  it('recognises names and dates of birth from the column name', () => {
    expect(decideColumn('Surname', facts(100, { distinct: 80 }), 100, 'UK').personal).toBe('name');
    expect(decideColumn('DOB', facts(100, { slashDates: 100, firstPartOver12: 50 }), 100, 'UK').personal).toBe(
      'date-of-birth',
    );
  });

  it('flags NHS numbers that fail the check digit', () => {
    const d = decideColumn(
      'NHS Number',
      facts(100, { nhsShaped: 100, nhsValid: 60, integers: 100, plainNumbers: 100, numberLike: 100 }),
      100,
      'UK',
    );
    expect(d.findings).toContainEqual(expect.objectContaining({ kind: 'invalid-nhs-numbers', rows: 40 }));
  });
});

describe('rankFindings', () => {
  it('puts high findings first, then the most rows affected', () => {
    const ranked = rankFindings([
      {
        name: 'A',
        decision: decideColumn(
          'A',
          facts(100, { distinct: 5, withSpaces: 100, placeholders: 10, placeholderValues: ['n/a'] }),
          100,
          'UK',
        ),
      },
      {
        name: 'B',
        decision: decideColumn('B', facts(100, { distinct: 11, numberLike: 100, percents: 100 }), 100, 'UK'),
      },
    ]);
    expect(ranked[0]).toMatchObject({ column: 'B', severity: 'high' });
  });
});
