import { describe, expect, it } from 'vitest';
import { describeFormat, explainProblem, formatBytes } from './explain';
import { detectFormat } from './detectFormat';

describe('explainProblem', () => {
  it('names the lines with the wrong number of columns', () => {
    const { title, detail } = explainProblem({
      kind: 'inconsistent-fields',
      expected: 3,
      count: 2,
      examples: [
        { line: 3, found: 2 },
        { line: 4, found: 4 },
      ],
    });
    expect(title).toBe('2 rows have the wrong number of columns');
    expect(detail).toBe(
      'The header has 3 columns, but lines 3 and 4 have 2 or 4. This usually means a value contains the delimiter without being quoted.',
    );
  });

  it('uses the singular for one row', () => {
    const { title } = explainProblem({
      kind: 'inconsistent-fields',
      expected: 2,
      count: 1,
      examples: [{ line: 5, found: 3 }],
    });
    expect(title).toBe('1 row has the wrong number of columns');
  });
});

describe('describeFormat', () => {
  it('summarises encoding, delimiter and header in one line', () => {
    const report = detectFormat(new TextEncoder().encode('a;b\n1;2\n'), false);
    expect(describeFormat(report)).toBe('UTF-8 · semicolon-delimited · header row');
  });
});

describe('formatBytes', () => {
  it.each([
    [512, '512 B'],
    [2048, '2.0 KB'],
    [5 * 1024 * 1024, '5.0 MB'],
  ])('%i bytes is %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});
