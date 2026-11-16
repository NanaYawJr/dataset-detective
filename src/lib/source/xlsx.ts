import { strFromU8, unzipSync } from 'fflate';
import { attr, scanXml } from './xml';

/**
 * Reads an Excel workbook (.xlsx, .xlsm). A workbook is a zip of XML files:
 * one lists the sheets, one holds the text shared between cells, one holds
 * the number formats, and there is one per worksheet.
 *
 * Values are read as stored, not as displayed, with one exception: Excel
 * stores a date as a day count, so a cell with a date format is written
 * out as the date it stands for (2025-01-28).
 */

export type WorkbookProblem = 'not-a-workbook' | 'binary-workbook' | 'no-sheets';

export class WorkbookError extends Error {
  readonly problem: WorkbookProblem;
  constructor(problem: WorkbookProblem) {
    super(problem);
    this.problem = problem;
  }
}

export interface SheetInfo {
  name: string;
  hidden: boolean;
}

export interface SheetGrid {
  /** Rows that hold at least one value, in order. Cells are text; missing cells are ''. */
  rows: string[][];
  /** For each kept row, its row number in the sheet (1-based). */
  rowNumbers: number[];
  mergedRanges: number;
  dateCells: number;
  /** Formula cells with no stored result (the file was never calculated by Excel). */
  formulasWithoutResult: number;
  errorCells: number;
}

export interface Workbook {
  sheets: SheetInfo[];
  /** True when dates count from 1904 (old Mac workbooks) instead of 1900. */
  date1904: boolean;
  readSheet(index: number): SheetGrid;
}

const DAY_MS = 86_400_000;
const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** Excel's built-in number formats that show a date or a time. */
function isBuiltInDateFormat(id: number): boolean {
  return (id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58);
}

/** Whether a custom number format such as `dd/mm/yyyy` or `[h]:mm` shows a date or a time. */
export function isDateFormatCode(code: string): boolean {
  if (/\[(h+|m+|s+)\]/i.test(code)) return true;
  const bare = code
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/\[[^\]]*\]/g, '');
  return /[ymdhs]/i.test(bare) && !/general/i.test(bare);
}

/** Turns Excel's day count into text: a date, a date and time, or a time on its own. */
export function excelSerialToText(serial: number, date1904: boolean): string | null {
  if (!Number.isFinite(serial) || serial < 0 || serial > 2_958_465.99999) return null;
  let days = Math.floor(serial);
  let seconds = Math.round((serial - days) * 86_400);
  if (seconds >= 86_400) {
    days += 1;
    seconds = 0;
  }
  const time = `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
  if (days === 0 && seconds > 0) return time;

  // The 1900 system counts a 29 Feb 1900 that never existed, so days after it are one too many.
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, days < 61 ? 31 : 30);
  const date = new Date(epoch + days * DAY_MS);
  const text = `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  return seconds > 0 ? `${text} ${time}` : text;
}

/** A stored number as a person would write it: 1.1000000000000001 becomes 1.1. */
export function cleanNumber(raw: string): string {
  const value = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(value)) return raw;
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
  return String(Number(value.toPrecision(15)));
}

/** Excel writes characters XML can't hold as _x000D_; turn them back. */
function decodeEscapes(text: string): string {
  if (!text.includes('_x')) return text;
  return text.replace(/_x([0-9a-fA-F]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** Zero-based column index from a cell reference: A1 → 0, AB12 → 27. */
export function columnIndex(ref: string): number {
  let index = 0;
  for (let i = 0; i < ref.length; i += 1) {
    const code = ref.charCodeAt(i);
    if (code < 65 || code > 90) break;
    index = index * 26 + (code - 64);
  }
  return index - 1;
}

type Entries = Map<string, Uint8Array>;

function unzip(bytes: Uint8Array, wanted: (name: string) => boolean): Entries {
  try {
    const files = unzipSync(bytes, { filter: (file) => wanted(file.name) });
    return new Map(Object.entries(files).map(([name, data]) => [name.toLowerCase(), data]));
  } catch {
    throw new WorkbookError('not-a-workbook');
  }
}

/** Resolves a relationship target against the folder of the file that names it. */
function resolvePath(baseFile: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = baseFile.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  return parts.join('/');
}

interface Relationship {
  id: string;
  type: string;
  path: string;
}

function readRelationships(entries: Entries, forFile: string): Relationship[] {
  const slash = forFile.lastIndexOf('/');
  const relsPath = `${forFile.slice(0, slash + 1)}_rels/${forFile.slice(slash + 1)}.rels`;
  const data = entries.get(relsPath.toLowerCase());
  const found: Relationship[] = [];
  if (!data) return found;
  scanXml(strFromU8(data), {
    open(name, attrs) {
      if (name !== 'Relationship') return;
      found.push({
        id: attr(attrs, 'Id') ?? '',
        type: attr(attrs, 'Type') ?? '',
        path: resolvePath(forFile, attr(attrs, 'Target') ?? ''),
      });
    },
  });
  return found;
}

function readSharedStrings(data: Uint8Array | undefined): string[] {
  const strings: string[] = [];
  if (!data) return strings;
  let current = '';
  let inText = false;
  let inPhonetic = false;
  scanXml(strFromU8(data), {
    open(name, _attrs, selfClosing) {
      if (name === 'si') current = '';
      else if (name === 'rPh') inPhonetic = true;
      else if (name === 't' && !selfClosing) inText = !inPhonetic;
    },
    close(name) {
      if (name === 'si') strings.push(decodeEscapes(current));
      else if (name === 'rPh') inPhonetic = false;
      else if (name === 't') inText = false;
    },
    text(text) {
      if (inText) current += text;
    },
  });
  return strings;
}

/** For each cell style, whether it shows a date or time. */
function readDateStyles(data: Uint8Array | undefined): boolean[] {
  const dateStyles: boolean[] = [];
  if (!data) return dateStyles;
  const customDate = new Map<number, boolean>();
  let inCellXfs = false;
  scanXml(strFromU8(data), {
    open(name, attrs) {
      if (name === 'numFmt') {
        customDate.set(Number(attr(attrs, 'numFmtId')), isDateFormatCode(attr(attrs, 'formatCode') ?? ''));
      } else if (name === 'cellXfs') inCellXfs = true;
      else if (name === 'xf' && inCellXfs) {
        const id = Number(attr(attrs, 'numFmtId') ?? 0);
        dateStyles.push(customDate.get(id) ?? isBuiltInDateFormat(id));
      }
    },
    close(name) {
      if (name === 'cellXfs') inCellXfs = false;
    },
  });
  return dateStyles;
}

function readGrid(xml: string, shared: string[], dateStyles: boolean[], date1904: boolean): SheetGrid {
  const grid: SheetGrid = {
    rows: [],
    rowNumbers: [],
    mergedRanges: 0,
    dateCells: 0,
    formulasWithoutResult: 0,
    errorCells: 0,
  };
  let row: string[] = [];
  let rowNumber = 0;
  let nextColumn = 0;
  let cellType = '';
  let cellStyle = -1;
  let cellColumn = 0;
  let value = '';
  let hasFormula = false;
  let collecting = false;
  let inCell = false;

  const cellText = (): string => {
    switch (cellType) {
      case 's':
        return shared[Number(value)] ?? '';
      case 'inlineStr':
      case 'str':
        return decodeEscapes(value);
      case 'b':
        return value === '1' ? 'TRUE' : 'FALSE';
      case 'e':
        grid.errorCells += 1;
        return value;
      case 'd':
        return value.replace('T', ' ');
      default: {
        if (value === '') {
          if (hasFormula) grid.formulasWithoutResult += 1;
          return '';
        }
        if (dateStyles[cellStyle]) {
          const date = excelSerialToText(Number(value), date1904);
          if (date !== null) {
            grid.dateCells += 1;
            return date;
          }
        }
        return cleanNumber(value);
      }
    }
  };

  scanXml(xml, {
    open(name, attrs, selfClosing) {
      if (name === 'row') {
        row = [];
        nextColumn = 0;
        rowNumber = Number(attr(attrs, 'r')) || rowNumber + 1;
      } else if (name === 'c') {
        const ref = attr(attrs, 'r');
        cellColumn = ref ? columnIndex(ref) : nextColumn;
        nextColumn = cellColumn + 1;
        cellType = attr(attrs, 't') ?? '';
        cellStyle = Number(attr(attrs, 's') ?? -1);
        value = '';
        hasFormula = false;
        inCell = true;
      } else if (name === 'f') hasFormula = true;
      else if ((name === 'v' || name === 't') && inCell && !selfClosing) collecting = true;
      else if (name === 'mergeCell') grid.mergedRanges += 1;
    },
    close(name) {
      if (name === 'v' || name === 't') collecting = false;
      else if (name === 'c') {
        inCell = false;
        const text = cellText();
        if (text !== '' && cellColumn >= 0) {
          while (row.length < cellColumn) row.push('');
          row[cellColumn] = text;
        }
      } else if (name === 'row' && row.some((cell) => cell.trim() !== '')) {
        grid.rows.push(row);
        grid.rowNumbers.push(rowNumber);
      }
    },
    text(text) {
      if (collecting) value += text;
    },
  });
  return grid;
}

export function openWorkbook(bytes: Uint8Array): Workbook {
  const isSheet = (name: string) => /worksheets\/[^/]+\.xml$/i.test(name);
  const entries = unzip(
    bytes,
    (name) => /\.(xml|rels)$/i.test(name) && !isSheet(name) && !/\/(theme|media)\//i.test(name),
  );

  const root = readRelationships(entries, '').find((r) => r.type.endsWith('/officeDocument'));
  const workbookPath = root?.path ?? 'xl/workbook.xml';
  const workbookXml = entries.get(workbookPath.toLowerCase());
  if (!workbookXml) {
    // An .xlsb workbook has the same zip wrapper but binary parts instead of XML.
    const binary = unzip(bytes, (name) => /workbook\.bin$/i.test(name)).size > 0;
    throw new WorkbookError(binary ? 'binary-workbook' : 'not-a-workbook');
  }

  const relationships = readRelationships(entries, workbookPath);
  const pathFor = (suffix: string) => relationships.find((r) => r.type.endsWith(suffix))?.path.toLowerCase();
  const sheets: (SheetInfo & { path: string })[] = [];
  let date1904 = false;
  scanXml(strFromU8(workbookXml), {
    open(name, attrs) {
      if (name === 'workbookPr') date1904 = ['1', 'true'].includes(attr(attrs, 'date1904') ?? '');
      else if (name === 'sheet') {
        // The relationship id is namespaced, usually as r:id.
        const id = attr(attrs, 'r:id') ?? /[ :]id="([^"]*)"/.exec(attrs)?.[1];
        const path = relationships.find((r) => r.id === id && r.type.endsWith('/worksheet'))?.path;
        // Chart sheets and macro sheets have no cell grid, so they are left out.
        if (path) {
          const state = attr(attrs, 'state') ?? 'visible';
          sheets.push({ name: attr(attrs, 'name') ?? `Sheet ${sheets.length + 1}`, hidden: state !== 'visible', path });
        }
      }
    },
  });
  if (sheets.length === 0) throw new WorkbookError('no-sheets');

  const shared = readSharedStrings(entries.get(pathFor('/sharedStrings') ?? 'xl/sharedstrings.xml'));
  const dateStyles = readDateStyles(entries.get(pathFor('/styles') ?? 'xl/styles.xml'));

  return {
    sheets: sheets.map(({ name, hidden }) => ({ name, hidden })),
    date1904,
    readSheet(index) {
      const wanted = sheets[index].path.toLowerCase();
      const data = unzip(bytes, (name) => name.toLowerCase() === wanted).get(wanted);
      if (!data) throw new WorkbookError('not-a-workbook');
      return readGrid(strFromU8(data), shared, dateStyles, date1904);
    },
  };
}
