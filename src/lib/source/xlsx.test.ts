import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { tableFromGrid } from './grid';
import { cleanNumber, columnIndex, excelSerialToText, isDateFormatCode, openWorkbook, WorkbookError } from './xlsx';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

describe('Excel dates', () => {
  it('turns a day count into the date it stands for', () => {
    expect(excelSerialToText(45685, false)).toBe('2025-01-28');
    expect(excelSerialToText(1, false)).toBe('1900-01-01');
    expect(excelSerialToText(59, false)).toBe('1900-02-28');
    expect(excelSerialToText(61, false)).toBe('1900-03-01');
    expect(excelSerialToText(45685.5, false)).toBe('2025-01-28 12:00:00');
    expect(excelSerialToText(0.75, false)).toBe('18:00:00');
  });

  it('counts from 1904 in old Mac workbooks', () => {
    expect(excelSerialToText(0, true)).toBe('1904-01-01');
    expect(excelSerialToText(44223, true)).toBe('2025-01-28');
  });

  it('refuses numbers that cannot be dates', () => {
    expect(excelSerialToText(-1, false)).toBeNull();
    expect(excelSerialToText(3_000_000, false)).toBeNull();
  });

  it('recognises date formats and leaves number formats alone', () => {
    expect(isDateFormatCode('dd/mm/yyyy')).toBe(true);
    expect(isDateFormatCode('[h]:mm')).toBe(true);
    expect(isDateFormatCode('d mmm yyyy')).toBe(true);
    expect(isDateFormatCode('0.00')).toBe(false);
    expect(isDateFormatCode('#,##0.00 "days"')).toBe(false);
    expect(isDateFormatCode('[Red]0.0')).toBe(false);
    expect(isDateFormatCode('General')).toBe(false);
  });
});

describe('cell helpers', () => {
  it('reads column letters', () => {
    expect([columnIndex('A1'), columnIndex('Z9'), columnIndex('AA10'), columnIndex('AB12')]).toEqual([0, 25, 26, 27]);
  });

  it('removes floating-point noise but keeps real precision', () => {
    expect(cleanNumber('1.1000000000000001')).toBe('1.1');
    expect(cleanNumber('0.30000000000000004')).toBe('0.3');
    expect(cleanNumber('24.66')).toBe('24.66');
    expect(cleanNumber('1024')).toBe('1024');
    expect(cleanNumber('-15.37')).toBe('-15.37');
  });
});

describe('a workbook written by openpyxl', () => {
  const workbook = openWorkbook(fixture('openpyxl.xlsx'));

  it('lists the sheets and which are hidden', () => {
    expect(workbook.sheets).toEqual([
      { name: 'Notes', hidden: false },
      { name: 'Visits', hidden: false },
      { name: 'Lookup', hidden: true },
    ]);
  });

  it('reads inline text, dates, entities and formulas with no stored result', () => {
    const grid = workbook.readSheet(1);
    expect(grid.rows[0]).toEqual(['Clinic visits']);
    expect(grid.rows[1]).toEqual(['Visit ID', 'Seen', 'Clinic & Site', 'Minutes', 'Cost']);
    expect(grid.rows[2]).toEqual(['V001', '2025-01-04', 'Site <1>', '11']);
    expect(grid.rowNumbers.slice(0, 3)).toEqual([1, 3, 4]);
    expect(grid.mergedRanges).toBe(1);
    expect(grid.dateCells).toBe(30);
    expect(grid.formulasWithoutResult).toBe(30);
  });

  it('finds the table under the title', () => {
    const table = tableFromGrid(workbook.readSheet(1).rows);
    expect(table.rowsAboveHeader).toBe(1);
    expect(table.header).toEqual(['Visit ID', 'Seen', 'Clinic & Site', 'Minutes', 'Cost']);
    expect(table.rows).toHaveLength(30);
    // Cost holds only formulas with no stored result: the column is kept, and is empty.
    expect(table.emptyColumns).toBe(0);
    expect(table.rows.every((row) => row[4] === '')).toBe(true);
    // Row 10 of the sheet had its site cleared.
    expect(table.rows[6]).toEqual(['V007', '2025-01-22', '', '17', '']);
  });
});

describe('a workbook written by XlsxWriter', () => {
  const workbook = openWorkbook(fixture('xlsxwriter.xlsx'));
  const grid = workbook.readSheet(0);

  it('reads shared text, dates, date-times, booleans and stored formula results', () => {
    expect(grid.rows[0]).toEqual(['Ref', 'When', 'Logged', 'Share', 'Paid', 'Total', 'Status', 'Note']);
    expect(grid.rows[1]).toEqual(['R1', '2026-03-01', '2026-03-01 09:15:00', '0.01', 'FALSE', '2', 'open']);
    expect(grid.rows[3].slice(0, 5)).toEqual(['R3', '2026-03-03', '2026-03-03 09:15:00', '0.03', 'TRUE']);
    expect(grid.formulasWithoutResult).toBe(0);
  });

  it('keeps error values and awkward text exactly', () => {
    expect(grid.rows[3][7]).toBe('#DIV/0!');
    expect(grid.rows[4][7]).toBe('He said "hi", then left');
  });

  it('reads 1904-based dates correctly', () => {
    const old = openWorkbook(fixture('date1904.xlsx'));
    expect(old.date1904).toBe(true);
    expect(old.readSheet(0).rows[1]).toEqual(['Item 1', '2025-06-01']);
  });
});

describe('files that are not workbooks', () => {
  it('rejects bytes that are not a zip', () => {
    expect(() => openWorkbook(new TextEncoder().encode('a,b\n1,2\n'))).toThrow(WorkbookError);
  });
});

describe('tableFromGrid', () => {
  it('takes the first row as the header when there is no title', () => {
    const table = tableFromGrid([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(table).toMatchObject({ header: ['a', 'b'], rows: [['1', '2']], rowsAboveHeader: 0 });
  });

  it('skips titles and notes above the header, and empty spacer columns', () => {
    const table = tableFromGrid([
      ['Quarterly report'],
      ['', 'Prepared 3 March'],
      ['', 'Name', '', 'Score', 'Grade'],
      ['', 'Ada', '', '9', 'A'],
      ['', 'Ben', '', '7', 'B'],
      ['', 'Cy', '', '', 'C'],
    ]);
    expect(table.header).toEqual(['Name', 'Score', 'Grade']);
    expect(table.rows).toEqual([
      ['Ada', '9', 'A'],
      ['Ben', '7', 'B'],
      ['Cy', '', 'C'],
    ]);
    expect(table.rowsAboveHeader).toBe(2);
    expect(table.emptyColumns).toBe(2);
  });

  it('handles an empty sheet', () => {
    expect(tableFromGrid([]).header).toEqual([]);
  });
});
