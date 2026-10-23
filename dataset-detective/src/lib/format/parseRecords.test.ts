import { describe, expect, it } from 'vitest';
import { parseRecords } from './parseRecords';

const fields = (text: string, delimiter = ',') => parseRecords(text, delimiter).records.map((r) => r.fields);

describe('parseRecords', () => {
  it('splits simple rows', () => {
    expect(fields('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps delimiters and line breaks inside quoted fields', () => {
    expect(fields('name,note\n"Smith, J","line one\nline two"\n')).toEqual([
      ['name', 'note'],
      ['Smith, J', 'line one\nline two'],
    ]);
  });

  it('turns doubled quotes into a literal quote', () => {
    expect(fields('a\n"say ""hi"""\n')).toEqual([['a'], ['say "hi"']]);
  });

  it('handles CRLF and CR line endings', () => {
    expect(fields('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(fields('a,b\r1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('skips blank lines but keeps empty fields', () => {
    expect(fields('a,b\n\n1,\n')).toEqual([
      ['a', 'b'],
      ['1', ''],
    ]);
  });

  it('records the line each row starts on, counting quoted line breaks', () => {
    const { records } = parseRecords('h\n"x\ny"\nz\n', ',');
    expect(records.map((r) => r.line)).toEqual([1, 2, 4]);
  });

  it('reports a quote that is never closed', () => {
    expect(parseRecords('a\n"open', ',').unterminatedQuote).toBe(true);
    expect(parseRecords('a\n"closed"', ',').unterminatedQuote).toBe(false);
  });

  it('stops after maxRecords', () => {
    expect(parseRecords('1\n2\n3\n', ',', 2).records).toHaveLength(2);
  });
});
