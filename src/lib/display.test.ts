import { describe, expect, it } from 'vitest';
import { dateFromKey, describeDateOrder, formatDateKey, formatMeasure, roleLabel, typeLabel } from './display';

describe('labels', () => {
  it('names types and roles in plain English', () => {
    expect(typeLabel('integer')).toBe('Whole number');
    expect(roleLabel('free-text')).toBe('Free text');
  });
});

describe('date keys', () => {
  it('turns yyyymmdd into a date', () => {
    expect(dateFromKey(20260106).toISOString().slice(0, 10)).toBe('2026-01-06');
  });

  it('formats in the region style', () => {
    expect(formatDateKey(20251231, 'UK')).toBe('31 Dec 2025');
    expect(formatDateKey(20251231, 'CA')).toBe('2025-12-31');
    expect(formatDateKey(20251231, 'US')).toBe('Dec 31, 2025');
  });
});

describe('formatMeasure', () => {
  it('keeps the percent sign for percent columns', () => {
    expect(formatMeasure(4.9231, 'percent', 'UK')).toBe('4.92%');
    expect(formatMeasure(-7569.44, 'decimal', 'UK')).toBe('-7,569.44');
  });
});

describe('describeDateOrder', () => {
  it('says how the order was decided', () => {
    expect(describeDateOrder({ order: 'day-first', basis: 'evidence', evidence: 3 }, 'UK')).toBe('day-first, proven');
    expect(describeDateOrder({ order: 'day-first', basis: 'other-column', evidence: 0, source: 'END' }, 'UK')).toBe(
      'day-first, like END',
    );
    expect(describeDateOrder({ order: 'month-first', basis: 'region-suggestion', evidence: 0 }, 'US')).toBe(
      'month-first? suggested for US',
    );
    expect(describeDateOrder({ order: null, basis: 'unresolved', evidence: 0 }, 'CA')).toBe('order unknown');
  });
});
