import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectDelimiter, detectEncoding, detectFormat, detectHeader, looksNumericOrDate } from './detectFormat';
import { parseRecords } from './parseRecords';

const utf8 = (text: string) => new TextEncoder().encode(text);
const detect = (text: string) => detectFormat(utf8(text), false);

describe('golden sample: samples/sales-sample.csv', () => {
  const bytes = new Uint8Array(readFileSync(new URL('../../../samples/sales-sample.csv', import.meta.url)));
  const report = detectFormat(bytes, false);

  it('reads cleanly as comma-delimited UTF-8 with a header row', () => {
    expect(report.readable).toBe(true);
    expect(report.problems).toEqual([]);
    expect(report.encoding).toBe('utf-8');
    expect(report.delimiter).toBe(',');
    expect(report.hasHeader).toBe(true);
    expect(report.lineEnding).toBe('LF');
  });

  it('finds all 12 columns and 1,378 data rows', () => {
    expect(report.columns).toHaveLength(12);
    expect(report.columns[0]).toBe('Order ID');
    expect(report.columns).toContain('City | Region');
    expect(report.sampledRows).toBe(1378);
  });

  it('is not fooled by the pipe inside "City | Region"', () => {
    expect(report.delimiter).not.toBe('|');
  });
});

describe('encoding', () => {
  it('recognises byte-order marks', () => {
    expect(detectEncoding(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe('utf-8-bom');
    expect(detectEncoding(new Uint8Array([0xff, 0xfe, 0x61, 0x00]))).toBe('utf-16le');
    expect(detectEncoding(new Uint8Array([0xfe, 0xff, 0x00, 0x61]))).toBe('utf-16be');
  });

  it('falls back to Windows-1252 when bytes are not valid UTF-8', () => {
    // "café" with é as the single byte 0xE9, as Excel on Windows saves it.
    expect(detectEncoding(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toBe('windows-1252');
  });

  it('does not reject a sample that ends half-way through a character', () => {
    // "é" in UTF-8 is 0xC3 0xA9; the sample stops after the first byte.
    expect(detectEncoding(new Uint8Array([0x61, 0xc3]), true)).toBe('utf-8');
  });

  it('does reject an incomplete character at the end of a complete file', () => {
    expect(detectEncoding(new Uint8Array([0x61, 0xc3]), false)).toBe('windows-1252');
  });

  it('flags binary files', () => {
    expect(detectEncoding(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]))).toBe('binary');
  });

  it('decodes a BOM file without the mark in the first column name', () => {
    const report = detectFormat(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('id,name\n1,a\n')]), false);
    expect(report.encoding).toBe('utf-8-bom');
    expect(report.columns[0]).toBe('id');
  });
});

describe('delimiter', () => {
  it.each([
    [',', 'a,b,c\n1,2,3\n4,5,6\n'],
    [';', 'a;b;c\n1,5;2;3\n4;5;6\n'],
    ['\t', 'a\tb\tc\n1\t2\t3\n'],
    ['|', 'a|b|c\n1|2|3\n'],
  ])('detects %j', (expected, text) => {
    expect(detectDelimiter(text)).toBe(expected);
  });

  it('prefers the delimiter that gives consistent rows over one that appears in values', () => {
    // Commas appear inside quoted values; semicolons separate fields.
    expect(detectDelimiter('name;amount\n"Smith, J";1\n"Lee, K";2\n')).toBe(';');
  });
});

describe('header row', () => {
  const records = (text: string) => parseRecords(text, ',').records;

  it('recognises a header above numeric data', () => {
    expect(detectHeader(records('id,amount\n1,2.50\n2,3.75\n'))).toBe(true);
  });

  it('rejects a first row that contains numbers or dates', () => {
    expect(detectHeader(records('1,2.50\n2,3.75\n'))).toBe(false);
    expect(detectHeader(records('03/04/2026,x\n04/04/2026,y\n'))).toBe(false);
  });

  it('recognises a text header above text data when the names do not repeat', () => {
    expect(detectHeader(records('city,region\nLeeds,Yorkshire\nYork,Yorkshire\n'))).toBe(true);
  });

  it('generates column names when there is no header', () => {
    expect(detect('1,2\n3,4\n').columns).toEqual(['Column 1', 'Column 2']);
  });
});

describe('looksNumericOrDate', () => {
  it.each(['12', '-4.5', '1,234.56', '£20', '5%', '2026-10-21', '21/10/2026'])('%s counts', (v) => {
    expect(looksNumericOrDate(v)).toBe(true);
  });
  it.each(['', 'Leeds', 'LS1 4AB', '4-Not Specified'])('%j does not', (v) => {
    expect(looksNumericOrDate(v)).toBe(false);
  });
});

describe('problems', () => {
  it('blocks an empty file', () => {
    const report = detectFormat(new Uint8Array(), false);
    expect(report.readable).toBe(false);
    expect(report.problems).toEqual([{ kind: 'empty-file' }]);
  });

  it('blocks rows with the wrong number of fields and says where they are', () => {
    const report = detect('a,b,c\n1,2,3\n4,5\n6,7,8,9\n10,11,12\n');
    expect(report.readable).toBe(false);
    expect(report.problems).toEqual([
      {
        kind: 'inconsistent-fields',
        expected: 3,
        count: 2,
        examples: [
          { line: 3, found: 2 },
          { line: 4, found: 4 },
        ],
      },
    ]);
  });

  it('blocks a quote that is never closed', () => {
    const report = detect('a,b\n1,"open\n2,3\n');
    expect(report.readable).toBe(false);
    expect(report.problems.map((p) => p.kind)).toContain('unterminated-quote');
  });

  it('does not treat a cut-off sample as a broken file', () => {
    const text = 'a,b\n1,2\n3,"long value that continues past the sam';
    const report = detectFormat(utf8(text), true);
    expect(report.readable).toBe(true);
    expect(report.sampledRows).toBe(1);
  });

  it('notes blank and duplicate column names without blocking', () => {
    const report = detect('id,,Name,name\n1,2,3,4\n');
    expect(report.readable).toBe(true);
    expect(report.problems).toEqual([
      { kind: 'blank-headers', positions: [2] },
      { kind: 'duplicate-headers', names: ['name'] },
    ]);
  });
});
