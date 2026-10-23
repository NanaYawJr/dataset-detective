import { DELIMITER_NAMES, type Encoding, type FormatProblem, type FormatReport } from './detectFormat';

export interface Explanation {
  title: string;
  detail: string;
}

const ENCODING_NAMES: Record<Encoding, string> = {
  'utf-8': 'UTF-8',
  'utf-8-bom': 'UTF-8 (with byte-order mark)',
  'utf-16le': 'UTF-16',
  'utf-16be': 'UTF-16 (big-endian)',
  'windows-1252': 'Windows-1252',
};

export function encodingName(encoding: Encoding): string {
  return ENCODING_NAMES[encoding];
}

function lineList(lines: number[]): string {
  if (lines.length === 1) return `line ${lines[0]}`;
  return `lines ${lines.slice(0, -1).join(', ')} and ${lines[lines.length - 1]}`;
}

export function explainProblem(problem: FormatProblem): Explanation {
  switch (problem.kind) {
    case 'empty-file':
      return { title: 'The file is empty', detail: 'There is nothing to profile. Check that the export finished.' };
    case 'not-text':
      return {
        title: "This doesn't look like a text file",
        detail:
          'It contains binary data. If it is an Excel workbook, save it as CSV for now — Excel support is coming.',
      };
    case 'unterminated-quote':
      return {
        title: 'A quoted value is never closed',
        detail: `A value that starts with a double quote (") runs to the end of the file, starting near line ${problem.line}. The export may have been cut off.`,
      };
    case 'inconsistent-fields': {
      const lines = problem.examples.map((e) => e.line);
      const found = [...new Set(problem.examples.map((e) => e.found))].join(' or ');
      const rows = problem.count === 1 ? '1 row has' : `${problem.count} rows have`;
      return {
        title: `${rows} the wrong number of columns`,
        detail: `The header has ${problem.expected} columns, but ${lineList(lines)} ${lines.length === 1 ? 'has' : 'have'} ${found}. This usually means a value contains the delimiter without being quoted.`,
      };
    }
    case 'blank-headers':
      return {
        title: 'Some columns have no name',
        detail: `Column ${problem.positions.join(', ')} ${problem.positions.length === 1 ? 'has' : 'have'} a blank header. They are given placeholder names.`,
      };
    case 'duplicate-headers':
      return {
        title: 'Some column names are repeated',
        detail: `${problem.names.map((n) => `"${n}"`).join(', ')} ${problem.names.length === 1 ? 'appears' : 'appear'} more than once. Repeats are numbered so they stay separate.`,
      };
  }
}

export function describeFormat(format: FormatReport): string {
  return [
    encodingName(format.encoding),
    `${DELIMITER_NAMES[format.delimiter]}-delimited`,
    format.hasHeader ? 'header row' : 'no header row',
  ].join(' · ');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
