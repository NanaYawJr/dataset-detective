import { describe, expect, it } from 'vitest';
import { formatDate, formatNumber, formatPercent, isRegion, regionInfo } from './region';

const date = new Date(Date.UTC(2026, 9, 21)); // 21 October 2026

describe('formatDate', () => {
  it('never produces an ambiguous slash date', () => {
    expect(formatDate(date, 'UK')).toBe('21 Oct 2026');
    expect(formatDate(date, 'CA')).toBe('2026-10-21');
    expect(formatDate(date, 'US')).toBe('Oct 21, 2026');
  });

  it('pads single-digit days and months in ISO form', () => {
    expect(formatDate(new Date(Date.UTC(2026, 2, 4)), 'CA')).toBe('2026-03-04');
  });
});

describe('numbers', () => {
  it('groups thousands for every region', () => {
    expect(formatNumber(1378, 'UK')).toBe('1,378');
    expect(formatNumber(1378, 'CA')).toBe('1,378');
    expect(formatNumber(1378, 'US')).toBe('1,378');
  });

  it('formats shares as percentages', () => {
    expect(formatPercent(0.2177, 'UK')).toBe('21.8%');
  });
});

describe('region settings', () => {
  it('suggests a date order and Power Query culture per region', () => {
    expect(regionInfo('UK')).toMatchObject({ locale: 'en-GB', defaultDateOrder: 'day-first' });
    expect(regionInfo('CA')).toMatchObject({ locale: 'en-CA', defaultDateOrder: 'year-first' });
    expect(regionInfo('US')).toMatchObject({ locale: 'en-US', defaultDateOrder: 'month-first' });
  });

  it('only accepts known regions from storage', () => {
    expect(isRegion('CA')).toBe(true);
    expect(isRegion('FR')).toBe(false);
    expect(isRegion(null)).toBe(false);
  });
});
