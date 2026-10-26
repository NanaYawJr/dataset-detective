import { describe, expect, it } from 'vitest';
import { isPlaceholder } from './patterns';

describe('isPlaceholder', () => {
  it.each([
    'N/A',
    'n/a',
    'NULL',
    ' none ',
    '-',
    'Unknown',
    'Not Specified',
    '4-Not Specified',
    '9. Not known',
    '1900-01-01',
    '31/12/9999',
  ])('%j is a placeholder', (value) => {
    expect(isPlaceholder(value)).toBe(true);
  });

  it.each(['0', 'Leeds', '2-High', 'Not urgent', '2026-10-25', 'Nan Smith'])('%j is a real value', (value) => {
    expect(isPlaceholder(value)).toBe(false);
  });
});
