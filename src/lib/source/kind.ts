import type { SourceKind } from './types';

/** `legacy-excel` covers .xls files and password-protected workbooks, which share a container format. */
export type DetectedKind = SourceKind | 'legacy-excel';

const startsWith = (bytes: Uint8Array, signature: number[]) => signature.every((byte, i) => bytes[i] === byte);

/**
 * Decides how to read a file from its first bytes, falling back to its
 * name. The bytes win: a workbook renamed to .csv is still a workbook.
 */
export function detectKind(fileName: string, head: Uint8Array): DetectedKind {
  if (startsWith(head, [0x50, 0x41, 0x52, 0x31])) return 'parquet'; // PAR1
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) return 'excel'; // a zip, which is what .xlsx is
  if (startsWith(head, [0xd0, 0xcf, 0x11, 0xe0])) return 'legacy-excel';

  const extension = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase() ?? '';
  if (['json', 'jsonl', 'ndjson', 'geojson'].includes(extension)) return 'json';
  if (extension === 'parquet') return 'parquet';
  return 'delimited';
}
