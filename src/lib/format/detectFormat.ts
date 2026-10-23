import { parseRecords, type ParsedRecord } from './parseRecords';

/**
 * Lane 1 of the pipeline: work out how a delimited text file is written
 * (encoding, delimiter, header row) and whether it can be read cleanly,
 * using a sample from the start of the file.
 */

export type Encoding = 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16be' | 'windows-1252';
export type Delimiter = ',' | ';' | '\t' | '|';
export type LineEnding = 'LF' | 'CRLF' | 'CR' | 'none';

export const DELIMITER_NAMES: Record<Delimiter, string> = {
  ',': 'comma',
  ';': 'semicolon',
  '\t': 'tab',
  '|': 'pipe',
};

export type FormatProblem =
  | { kind: 'empty-file' }
  | { kind: 'not-text' }
  | { kind: 'unterminated-quote'; line: number }
  | {
      kind: 'inconsistent-fields';
      expected: number;
      /** Number of sampled rows with the wrong number of fields. */
      count: number;
      /** First few offending rows, for the explanation. */
      examples: { line: number; found: number }[];
    }
  | { kind: 'blank-headers'; positions: number[] }
  | { kind: 'duplicate-headers'; names: string[] };

/** Problems that stop loading until the user decides what to do. */
export const BLOCKING_PROBLEMS: FormatProblem['kind'][] = [
  'empty-file',
  'not-text',
  'unterminated-quote',
  'inconsistent-fields',
];

export interface FormatReport {
  encoding: Encoding;
  delimiter: Delimiter;
  hasHeader: boolean;
  lineEnding: LineEnding;
  /** Column names from the header row, or generated names if there is none. */
  columns: string[];
  /** Data rows examined in the sample (excludes the header). */
  sampledRows: number;
  /** True when only the start of the file was examined. */
  sampleTruncated: boolean;
  problems: FormatProblem[];
  readable: boolean;
}

const CANDIDATES: Delimiter[] = [',', ';', '\t', '|'];
const RECORDS_FOR_DETECTION = 200;
const MAX_EXAMPLES = 5;

/** Values that look like numbers, money, percentages or dates. */
const NUMERIC_LIKE = /^[-+]?[£$€]?\d[\d,]*(\.\d+)?%?$/;
const DATE_LIKE = /^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}$/;

export function looksNumericOrDate(value: string): boolean {
  const v = value.trim();
  return v !== '' && (NUMERIC_LIKE.test(v) || DATE_LIKE.test(v));
}

export function detectEncoding(bytes: Uint8Array, sampleTruncated = false): Encoding | 'binary' {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8-bom';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';

  const head = bytes.subarray(0, 8192);
  if (head.includes(0)) return 'binary';

  try {
    // When the sample stops part-way through the file, stream mode tolerates a
    // multi-byte character cut off at the very end of it.
    new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: sampleTruncated });
    return 'utf-8';
  } catch {
    // Not valid UTF-8: most often a file saved from Excel on Windows.
    return 'windows-1252';
  }
}

export function decode(bytes: Uint8Array, encoding: Encoding): string {
  switch (encoding) {
    case 'utf-8':
      return new TextDecoder('utf-8').decode(bytes);
    case 'utf-8-bom':
      return new TextDecoder('utf-8').decode(bytes.subarray(3));
    case 'utf-16le':
      return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    case 'utf-16be':
      return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    case 'windows-1252':
      return new TextDecoder('windows-1252').decode(bytes);
  }
}

function detectLineEnding(text: string): LineEnding {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length - crlf;
  const cr = (text.match(/\r/g) ?? []).length - crlf;
  if (crlf === 0 && lf === 0 && cr === 0) return 'none';
  if (crlf >= lf && crlf >= cr) return 'CRLF';
  return lf >= cr ? 'LF' : 'CR';
}

function mode(values: number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = 0;
  let bestCount = -1;
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && value > best)) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Pick the delimiter that splits the sample into the most consistent
 * number of fields per row (and more than one field).
 */
export function detectDelimiter(text: string): Delimiter {
  let best: Delimiter = ',';
  let bestScore = -1;

  for (const candidate of CANDIDATES) {
    const { records } = parseRecords(text, candidate, RECORDS_FOR_DETECTION);
    if (records.length === 0) continue;
    const widths = records.map((r) => r.fields.length);
    const typical = mode(widths);
    if (typical < 2) continue;
    const consistency = widths.filter((w) => w === typical).length / widths.length;
    // Consistency matters most; more fields breaks ties.
    const score = consistency * 1000 + typical;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/**
 * A first row is treated as a header when it contains no numbers or dates
 * and either some column below it is mostly numbers/dates, or none of its
 * values reappear further down its column.
 */
export function detectHeader(records: ParsedRecord[]): boolean {
  if (records.length === 0) return false;
  const [first, ...rest] = records;
  if (first.fields.some(looksNumericOrDate)) return false;
  if (rest.length === 0) return true;

  for (let col = 0; col < first.fields.length; col += 1) {
    const values = rest.map((r) => r.fields[col]).filter((v): v is string => v !== undefined && v.trim() !== '');
    if (values.length === 0) continue;
    const numericShare = values.filter(looksNumericOrDate).length / values.length;
    if (numericShare >= 0.5) return true;
  }

  return first.fields.every((name, col) => !rest.some((r) => r.fields[col] === name));
}

export function generatedColumnNames(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `Column ${i + 1}`);
}

export function detectFormat(bytes: Uint8Array, sampleTruncated: boolean): FormatReport {
  const base = {
    encoding: 'utf-8' as Encoding,
    delimiter: ',' as Delimiter,
    hasHeader: false,
    lineEnding: 'none' as LineEnding,
    columns: [] as string[],
    sampledRows: 0,
    sampleTruncated,
  };

  if (bytes.length === 0) {
    return { ...base, problems: [{ kind: 'empty-file' }], readable: false };
  }

  const encoding = detectEncoding(bytes, sampleTruncated);
  if (encoding === 'binary') {
    return { ...base, problems: [{ kind: 'not-text' }], readable: false };
  }

  let text = decode(bytes, encoding);
  if (sampleTruncated) {
    // The last line of the sample is probably cut short: drop it.
    const lastBreak = Math.max(text.lastIndexOf('\n'), text.lastIndexOf('\r'));
    if (lastBreak > 0) text = text.slice(0, lastBreak);
  }

  if (text.trim() === '') {
    return { ...base, encoding, problems: [{ kind: 'empty-file' }], readable: false };
  }

  const delimiter = detectDelimiter(text);
  const lineEnding = detectLineEnding(text);
  const { records, unterminatedQuote } = parseRecords(text, delimiter);
  const hasHeader = detectHeader(records.slice(0, RECORDS_FOR_DETECTION));

  const headerRecord = hasHeader ? records[0] : undefined;
  const dataRecords = hasHeader ? records.slice(1) : records;
  const expected = headerRecord ? headerRecord.fields.length : mode(dataRecords.map((r) => r.fields.length));
  const columns = headerRecord ? headerRecord.fields.map((name) => name.trim()) : generatedColumnNames(expected);

  const problems: FormatProblem[] = [];

  if (unterminatedQuote && !sampleTruncated) {
    const lastLine = records.length > 0 ? records[records.length - 1].line : 1;
    problems.push({ kind: 'unterminated-quote', line: lastLine });
  }

  const wrongWidth = dataRecords.filter((r) => r.fields.length !== expected);
  if (wrongWidth.length > 0) {
    problems.push({
      kind: 'inconsistent-fields',
      expected,
      count: wrongWidth.length,
      examples: wrongWidth.slice(0, MAX_EXAMPLES).map((r) => ({ line: r.line, found: r.fields.length })),
    });
  }

  if (headerRecord) {
    const blanks = columns.flatMap((name, i) => (name === '' ? [i + 1] : []));
    if (blanks.length > 0) problems.push({ kind: 'blank-headers', positions: blanks });

    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const name of columns) {
      if (name === '') continue;
      const key = name.toLowerCase();
      if (seen.has(key)) duplicates.add(name);
      seen.add(key);
    }
    if (duplicates.size > 0) problems.push({ kind: 'duplicate-headers', names: [...duplicates] });
  }

  return {
    encoding,
    delimiter,
    hasHeader,
    lineEnding,
    columns,
    sampledRows: dataRecords.length,
    sampleTruncated,
    problems,
    readable: !problems.some((p) => BLOCKING_PROBLEMS.includes(p.kind)),
  };
}
