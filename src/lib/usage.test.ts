import { describe, expect, it } from 'vitest';
import { usageBody } from './usage';

describe('usageBody', () => {
  it('holds the event type and, for a profile, the file format — and nothing else', () => {
    expect(usageBody({ type: 'visit' })).toBe('{"type":"visit"}');
    expect(usageBody({ type: 'profile', kind: 'excel' })).toBe('{"type":"profile","kind":"excel"}');
  });

  it('drops anything extra that is passed in by mistake', () => {
    const leaky = { type: 'profile', kind: 'json', fileName: 'payroll.json', rows: 1200 } as never;
    expect(usageBody(leaky)).toBe('{"type":"profile","kind":"json"}');
  });
});
