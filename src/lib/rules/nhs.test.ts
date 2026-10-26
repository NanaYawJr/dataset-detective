import { describe, expect, it } from 'vitest';
import { isValidNhsNumber } from './nhs';

describe('isValidNhsNumber', () => {
  it('accepts a valid number with or without spaces', () => {
    expect(isValidNhsNumber('9434765919')).toBe(true);
    expect(isValidNhsNumber('943 476 5919')).toBe(true);
    expect(isValidNhsNumber('943-476-5919')).toBe(true);
  });

  it('rejects a wrong check digit', () => {
    expect(isValidNhsNumber('9434765918')).toBe(false);
  });

  it('rejects numbers whose check digit would be 10', () => {
    // Weighted sum 1×10 + 1×2 = 12, which leaves 1 after dividing by 11: check value 10.
    expect(isValidNhsNumber('1000000010')).toBe(false);
    expect(isValidNhsNumber('1000000019')).toBe(false);
  });

  it('rejects the wrong length or non-digits', () => {
    expect(isValidNhsNumber('943476591')).toBe(false);
    expect(isValidNhsNumber('94347659190')).toBe(false);
    expect(isValidNhsNumber('943476591X')).toBe(false);
  });
});
