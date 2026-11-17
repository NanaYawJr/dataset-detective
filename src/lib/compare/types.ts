import type { Severity } from '../rules/types';

/** What changed in the rows, found by matching the two files on a key column. */
export interface RowDiff {
  /** The column both files were matched on. */
  key: string;
  /** Rows in the current file whose key is not in the earlier one. */
  added: number;
  /** Rows in the earlier file whose key is not in the current one. */
  removed: number;
  /** Rows present in both. */
  kept: number;
  /** Rows present in both where at least one shared column differs. */
  changed: number;
  /** For each shared column, how many kept rows differ in it. Only columns with a difference. */
  byColumn: { column: string; rows: number }[];
  examples: {
    added: string[];
    removed: string[];
    changed: { key: string; columns: string[] }[];
  };
}

/** Values of a category that appear in only one of the two files. */
export interface ValueSetDiff {
  column: string;
  added: string[];
  removed: string[];
}

/** What needs the two tables side by side in the database. */
export interface TableComparison {
  rows: RowDiff | null;
  /** Why rows couldn't be matched, when they couldn't. */
  noRowsReason: string | null;
  values: ValueSetDiff[];
}

export interface ColumnChange {
  severity: Severity;
  text: string;
  /** The same change with no values from the file in it, for sending to the explainer. */
  gist: string;
}

export interface ColumnComparison {
  name: string;
  changes: ColumnChange[];
}

export interface FindingChange {
  column: string;
  title: string;
  severity: Severity;
}

export interface Comparison {
  rows: { earlier: number; current: number };
  /** Columns only in the current file, and only in the earlier one. */
  added: string[];
  removed: string[];
  /** Columns whose names differ only in case, spaces or punctuation. */
  renamed: { from: string; to: string }[];
  reordered: boolean;
  /** Shared columns with something worth saying, most serious first. */
  columns: ColumnComparison[];
  findings: { fresh: FindingChange[]; resolved: FindingChange[] };
  /** One-line summary of the whole comparison. */
  headline: string;
}
