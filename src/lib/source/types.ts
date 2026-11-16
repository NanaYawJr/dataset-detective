import type { FormatReport } from '../format/detectFormat';
import type { SheetInfo } from './xlsx';

export type SourceKind = 'delimited' | 'excel' | 'parquet' | 'json';

/** Something about how the file was read that the reader of the report should know. */
export interface SourceNote {
  key: string;
  title: string;
  detail: string;
}

/** A summary figure shown beside the row and column counts. */
export interface SourceCard {
  label: string;
  value: string;
  hint: string;
}

export interface SourceDetails {
  kind: SourceKind;
  /** "Excel workbook", "Parquet file", … */
  label: string;
  /** Short facts for the one-line description: "sheet Orders", "header on row 4". */
  facts: string[];
  notes: SourceNote[];
  /** Empty for delimited text, whose cards come from the detected format. */
  cards: SourceCard[];
  /** Parquet only: the type the file declares for each column, in plain words. */
  declaredTypes?: Record<string, string>;
  /** Excel only: every sheet in the workbook, and which one was read. */
  sheets?: SheetInfo[];
  sheetIndex?: number;
  /** Excel only: the row of the sheet the header is on (1-based). */
  headerRow?: number;
  /** JSON only: where the list of records sits when it isn't the whole file, and whether it is one record per line. */
  listPath?: string;
  jsonLines?: boolean;
}

export interface PreparedSource {
  details: SourceDetails;
  /** How the table text is written. For Excel, Parquet and JSON this describes the text made from the file. */
  format: FormatReport;
  /** The delimited text the database reads: the file itself, or text made from it. */
  data: Blob;
}
