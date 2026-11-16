import {
  detectFormat,
  detectHeader,
  generatedColumnNames,
  headerProblems,
  type FormatProblem,
  type FormatReport,
} from '../format/detectFormat';
import { CsvBuilder } from './csvText';
import { tableFromGrid, type SheetTable } from './grid';
import { JsonError, readJson } from './json';
import { detectKind } from './kind';
import { openParquet, type DeclaredType } from './parquet';
import type { PreparedSource, SourceCard, SourceDetails, SourceNote } from './types';
import { openWorkbook, WorkbookError, type SheetGrid, type Workbook } from './xlsx';

/**
 * Stage 1 for every kind of file: work out what the file is and turn it
 * into delimited text the database can read. Delimited text is passed
 * through untouched; Excel, Parquet and JSON are read here and written out
 * as CSV in memory, so that every later stage is the same for all of them.
 */

/** How much of a delimited file is read to detect its format. */
export const FORMAT_SAMPLE_BYTES = 1024 * 1024;
const HEADER_SAMPLE_ROWS = 200;

export interface PrepareOptions {
  /** Excel only: which sheet to read. Left out, the first sheet holding a table is used. */
  sheet?: number;
}

const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;
const quoted = (names: string[], max = 4) => {
  const shown = names.slice(0, max).map((name) => `"${name}"`);
  const more = names.length - shown.length;
  return more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(shown.length === 2 ? ' and ' : ', ');
};

function blocked(details: SourceDetails, file: File, title: string, detail: string): PreparedSource {
  const problem: FormatProblem = { kind: 'cannot-read', title, detail };
  const format: FormatReport = {
    encoding: 'utf-8',
    delimiter: ',',
    hasHeader: false,
    lineEnding: 'none',
    columns: [],
    sampledRows: 0,
    sampleTruncated: false,
    problems: [problem],
    readable: false,
  };
  return { details, format, data: file };
}

/** Describes the CSV text made from a table. `headerCertain` is true when the names come from the file's own structure. */
function tableFormat(header: string[], rows: string[][], headerCertain: boolean): FormatReport {
  const sample = rows.slice(0, HEADER_SAMPLE_ROWS);
  const hasHeader = headerCertain || detectHeader([header, ...sample].map((fields, i) => ({ fields, line: i + 1 })));
  return {
    encoding: 'utf-8',
    delimiter: ',',
    hasHeader,
    lineEnding: 'LF',
    columns: hasHeader ? header : generatedColumnNames(header.length),
    sampledRows: sample.length + (hasHeader ? 0 : 1),
    sampleTruncated: rows.length > sample.length,
    problems: hasHeader ? headerProblems(header) : [],
    readable: true,
  };
}

function toCsv(header: string[], rows: string[][]): Blob {
  const builder = new CsvBuilder();
  builder.add(header);
  for (const row of rows) builder.add(row);
  return builder.toBlob();
}

// ---------- Excel ----------

interface ReadSheet {
  index: number;
  grid: SheetGrid;
  table: SheetTable;
}

/** The first visible sheet that holds a table; failing that, the first sheet with anything in it. */
function chooseSheet(workbook: Workbook): ReadSheet | null {
  const order = [
    ...workbook.sheets.flatMap((s, i) => (s.hidden ? [] : [i])),
    ...workbook.sheets.flatMap((s, i) => (s.hidden ? [i] : [])),
  ];
  let fallback: ReadSheet | null = null;
  for (const index of order) {
    const grid = workbook.readSheet(index);
    const table = tableFromGrid(grid.rows);
    if (table.header.length >= 2 && table.rows.length >= 1) return { index, grid, table };
    if (!fallback && table.header.length > 0) fallback = { index, grid, table };
  }
  return fallback;
}

function excelNotes(workbook: Workbook, { index, grid, table }: ReadSheet): SourceNote[] {
  const notes: SourceNote[] = [];
  const headerRow = grid.rowNumbers[table.headerIndex];
  if (table.rowsAboveHeader > 0) {
    notes.push({
      key: 'rows-above-header',
      title: `The header was found on row ${headerRow}`,
      detail: `${count(table.rowsAboveHeader, 'row')} above it ${table.rowsAboveHeader === 1 ? 'looks' : 'look'} like a title or notes, not data, and ${table.rowsAboveHeader === 1 ? 'was' : 'were'} left out.`,
    });
  }
  if (grid.dateCells > 0) {
    notes.push({
      key: 'excel-dates',
      title: 'Dates were stored as numbers',
      detail: `Excel stores a date as a count of days (28 Jan 2025 is 45685) and only shows it as a date. ${count(grid.dateCells, 'date cell')} ${grid.dateCells === 1 ? 'was' : 'were'} converted to the date ${grid.dateCells === 1 ? 'it stands' : 'they stand'} for${workbook.date1904 ? ', counting from 1904 as this workbook does' : ''}, so there is no day/month order to get wrong.`,
    });
  }
  if (grid.formulasWithoutResult > 0) {
    notes.push({
      key: 'formulas-without-result',
      title: `${count(grid.formulasWithoutResult, 'formula')} ${grid.formulasWithoutResult === 1 ? 'has' : 'have'} no stored result`,
      detail:
        'The workbook was saved by a program that did not calculate its formulas, so those cells are read as empty. Opening the file in Excel and saving it again stores the results.',
    });
  }
  if (grid.errorCells > 0) {
    notes.push({
      key: 'error-cells',
      title: `${count(grid.errorCells, 'cell')} ${grid.errorCells === 1 ? 'holds' : 'hold'} an Excel error`,
      detail: 'Values such as #N/A, #REF! or #DIV/0! are kept as text, so they show up in the column they are in.',
    });
  }
  if (grid.mergedRanges > 0) {
    notes.push({
      key: 'merged-cells',
      title: `${count(grid.mergedRanges, 'merged range')} in this sheet`,
      detail:
        'Only the first cell of a merged range holds the value. If cells are merged inside the table, the other rows in the range are read as empty.',
    });
  }
  if (table.emptyColumns > 0) {
    notes.push({
      key: 'empty-columns',
      title: `${count(table.emptyColumns, 'empty column')} left out`,
      detail: 'Columns with no header and no values (spacers, or columns to the left of the table) are not shown.',
    });
  }
  const hidden = workbook.sheets.filter((s, i) => s.hidden && i !== index).map((s) => s.name);
  if (hidden.length > 0) {
    notes.push({
      key: 'hidden-sheets',
      title: `${count(hidden.length, 'hidden sheet')} in this workbook`,
      detail: `${quoted(hidden)} ${hidden.length === 1 ? 'is' : 'are'} hidden in Excel. Hidden sheets can hold data people have forgotten is there; choose one from the sheet list to profile it.`,
    });
  }
  return notes;
}

async function prepareExcel(file: File, options: PrepareOptions): Promise<PreparedSource> {
  const details: SourceDetails = { kind: 'excel', label: 'Excel workbook', facts: [], notes: [], cards: [] };
  let workbook: Workbook;
  try {
    workbook = openWorkbook(new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    if (!(error instanceof WorkbookError)) throw error;
    if (error.problem === 'binary-workbook') {
      return blocked(
        details,
        file,
        'This is a binary Excel workbook (.xlsb)',
        'Dataset Detective reads .xlsx workbooks. Open the file in Excel, choose Save As, pick "Excel Workbook (.xlsx)", and try again.',
      );
    }
    if (error.problem === 'no-sheets') {
      return blocked(
        details,
        file,
        'This workbook has no worksheets',
        'It may hold only charts, or the file may be damaged.',
      );
    }
    return blocked(
      details,
      file,
      "This zip file isn't an Excel workbook",
      'An .xlsx file is a zip with a workbook inside, and this one has none. If it is a zip of other files, unzip it and profile the file you need.',
    );
  }

  const read: ReadSheet | null =
    options.sheet !== undefined && workbook.sheets[options.sheet]
      ? (() => {
          const grid = workbook.readSheet(options.sheet);
          return { index: options.sheet, grid, table: tableFromGrid(grid.rows) };
        })()
      : chooseSheet(workbook);

  details.sheets = workbook.sheets;
  if (!read || read.table.header.length === 0) {
    details.sheetIndex = read?.index;
    const name = read ? workbook.sheets[read.index].name : '';
    return blocked(
      details,
      file,
      read ? `The sheet "${name}" is empty` : 'No sheet in this workbook has any data',
      workbook.sheets.length > 1 && read
        ? 'There is nothing to profile on this sheet. Choose another file, or profile the workbook again and pick a different sheet.'
        : 'There is nothing to profile. Check that the export finished.',
    );
  }

  const { index, grid, table } = read;
  const sheet = workbook.sheets[index];
  const format = tableFormat(table.header, table.rows, false);
  details.sheetIndex = index;
  details.headerRow = format.hasHeader ? grid.rowNumbers[table.headerIndex] : undefined;
  details.facts = [
    `sheet "${sheet.name}"`,
    format.hasHeader ? `header on row ${grid.rowNumbers[table.headerIndex]}` : 'no header row',
  ];
  details.notes = excelNotes(workbook, read);
  details.cards = [
    {
      label: 'Sheet',
      value: sheet.name,
      hint: workbook.sheets.length === 1 ? 'The only sheet' : `Sheet ${index + 1} of ${workbook.sheets.length}`,
    },
    { label: 'Format', value: 'Excel workbook', hint: 'Values read as stored, not as displayed' },
  ];
  return { details, format, data: toCsv(table.header, table.rows) };
}

// ---------- Parquet ----------

function typeSummary(types: DeclaredType[]): string {
  const counts = new Map<DeclaredType, number>();
  for (const type of types) counts.set(type, (counts.get(type) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, n]) => `${n} ${type}`)
    .join(', ');
}

async function prepareParquet(file: File): Promise<PreparedSource> {
  const details: SourceDetails = { kind: 'parquet', label: 'Parquet file', facts: [], notes: [], cards: [] };
  const builder = new CsvBuilder();
  let parquet: Awaited<ReturnType<typeof openParquet>>;
  try {
    parquet = await openParquet(await file.arrayBuffer());
    builder.add(parquet.columns.map((c) => c.name));
    await parquet.writeRows(builder);
  } catch (error) {
    return blocked(
      details,
      file,
      "This Parquet file couldn't be read",
      `The file may be cut short or use a feature that isn't supported. The reader reported: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (parquet.columns.length === 0 || parquet.rowCount === 0) {
    return blocked(
      details,
      file,
      'This Parquet file has no rows',
      'There is nothing to profile. Check that the export finished.',
    );
  }

  const header = parquet.columns.map((c) => c.name);
  const summary = typeSummary(parquet.columns.map((c) => c.declared));
  const nested = parquet.columns
    .filter((c) => c.declared === 'list' || c.declared === 'nested record')
    .map((c) => c.name);
  const writer = parquet.createdBy?.replace(/\s*\(build.*\)$/, '');

  details.facts = [writer ? `written by ${writer}` : 'types declared in the file'];
  details.declaredTypes = Object.fromEntries(parquet.columns.map((c) => [c.name, c.declared]));
  details.notes = [
    {
      key: 'declared-types',
      title: 'Types are declared in this file',
      detail: `The file says its columns are: ${summary}. The checks below still look at the values themselves, so a column declared as text that holds only numbers or dates is reported as what it really contains.`,
    },
  ];
  if (nested.length > 0) {
    details.notes.push({
      key: 'nested-columns',
      title: `${count(nested.length, 'column')} ${nested.length === 1 ? 'holds' : 'hold'} lists or nested records`,
      detail: `${quoted(nested)} ${nested.length === 1 ? 'is' : 'are'} shown as JSON text, because a table cell holds one value.`,
    });
  }
  details.cards = [
    { label: 'Format', value: 'Parquet', hint: writer ? `Written by ${writer}` : 'Columnar file' },
    { label: 'Declared types', value: `${header.length} typed`, hint: summary },
  ];
  const format: FormatReport = {
    ...tableFormat(header, [], true),
    sampledRows: Math.min(parquet.rowCount, HEADER_SAMPLE_ROWS),
  };
  return { details, format, data: builder.toBlob() };
}

// ---------- JSON ----------

async function prepareJson(file: File): Promise<PreparedSource> {
  const details: SourceDetails = { kind: 'json', label: 'JSON file', facts: [], notes: [], cards: [] };
  let table: ReturnType<typeof readJson>;
  try {
    table = readJson(await file.text(), file.name);
  } catch (error) {
    if (!(error instanceof JsonError)) throw error;
    return error.problem === 'invalid'
      ? blocked(
          details,
          file,
          "This isn't valid JSON",
          `The file couldn't be parsed, so it may be cut short or hand-edited. The parser reported: ${error.message}`,
        )
      : blocked(
          details,
          file,
          'No list of records was found',
          'A table needs a list of records, such as [{"id": 1}, {"id": 2}], one record per line, or an object holding such a list. This file has none, or the list is empty.',
        );
  }

  const shapes: Record<typeof table.shape, string> = {
    list: 'a list of records',
    lines: 'one record per line',
    'list-under-key': `records under "${table.listPath}"`,
  };
  details.facts = [shapes[table.shape]];
  details.listPath = table.listPath;
  details.jsonLines = table.shape === 'lines';
  if (table.shape === 'list-under-key') {
    details.notes.push({
      key: 'list-under-key',
      title: `The records were found under "${table.listPath}"`,
      detail:
        table.otherLists.length > 0
          ? `The file is an object, not a list. Its longest list was used; ${quoted(table.otherLists)} ${table.otherLists.length === 1 ? 'was' : 'were'} not.`
          : 'The file is an object, not a list. Its other values (such as totals or paging details) are not part of the table.',
    });
  }
  if (table.nestedColumns.length > 0) {
    details.notes.push({
      key: 'nested-objects',
      title: `${count(table.nestedColumns.length, 'column')} came from nested objects`,
      detail: `Objects inside a record were flattened into columns named with a dot, such as ${quoted(table.nestedColumns, 3)}.`,
    });
  }
  if (table.listColumns.length > 0) {
    details.notes.push({
      key: 'list-columns',
      title: `${count(table.listColumns.length, 'column')} ${table.listColumns.length === 1 ? 'holds' : 'hold'} lists`,
      detail: `${quoted(table.listColumns)} ${table.listColumns.length === 1 ? 'is' : 'are'} kept as JSON text, because a table cell holds one value. Each list would be its own table in a database.`,
    });
  }
  const cards: SourceCard[] = [
    { label: 'Format', value: table.shape === 'lines' ? 'JSON Lines' : 'JSON', hint: shapes[table.shape] },
    {
      label: 'Structure',
      value: table.nestedColumns.length + table.listColumns.length > 0 ? 'Nested' : 'Flat',
      hint:
        table.nestedColumns.length + table.listColumns.length > 0
          ? `${count(table.nestedColumns.length, 'flattened column')}, ${count(table.listColumns.length, 'list column')}`
          : 'Every value is a single value',
    },
  ];
  details.cards = cards;
  return { details, format: tableFormat(table.header, table.rows, true), data: toCsv(table.header, table.rows) };
}

// ---------- Entry point ----------

export async function prepareSource(file: File, options: PrepareOptions = {}): Promise<PreparedSource> {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const kind = detectKind(file.name, head);

  if (kind === 'excel') return prepareExcel(file, options);
  if (kind === 'parquet') return prepareParquet(file);
  if (kind === 'json') return prepareJson(file);
  if (kind === 'legacy-excel') {
    return blocked(
      { kind: 'excel', label: 'Excel workbook', facts: [], notes: [], cards: [] },
      file,
      'This is an older Excel file (.xls) or a password-protected workbook',
      'Dataset Detective reads .xlsx workbooks without a password. Open the file in Excel, choose Save As, pick "Excel Workbook (.xlsx)" with no password, and try again.',
    );
  }

  const bytes = new Uint8Array(await file.slice(0, FORMAT_SAMPLE_BYTES).arrayBuffer());
  return {
    details: { kind: 'delimited', label: 'Delimited text', facts: [], notes: [], cards: [] },
    format: detectFormat(bytes, file.size > FORMAT_SAMPLE_BYTES),
    data: file,
  };
}
