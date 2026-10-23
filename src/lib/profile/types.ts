import type { FormatReport } from '../format/detectFormat';

export type Scope = 'full' | 'sample';

export interface ValueCount {
  value: string;
  count: number;
}

export interface ColumnStats {
  name: string;
  /** Rows with a non-blank value. */
  filled: number;
  /** Rows that are NULL or only whitespace. */
  empty: number;
  distinct: number;
  minLength: number | null;
  maxLength: number | null;
  topValues: ValueCount[];
  shapes: ValueCount[];
}

export interface ProfileResult {
  fileName: string;
  fileSize: number;
  format: FormatReport;
  scope: Scope;
  /** Rows in the whole file (after any skipped broken rows). */
  totalRows: number;
  /** Rows actually profiled: equals totalRows unless a sample was taken. */
  profiledRows: number;
  /** Rows DuckDB skipped because they were broken (only when the user chose to skip them). */
  skippedRows: number;
  columns: ColumnStats[];
  profiledAt: Date;
  durationMs: number;
}

export type Step = 'read-sample' | 'detect-format' | 'load' | 'stats' | 'shapes';

export const STEP_LABELS: Record<Step, string> = {
  'read-sample': 'Reading the start of the file',
  'detect-format': 'Detecting encoding, delimiter and header row',
  load: 'Loading into the in-browser database',
  stats: 'Computing counts, blanks and top values',
  shapes: 'Reading value shapes',
};

export const STEPS: Step[] = ['read-sample', 'detect-format', 'load', 'stats', 'shapes'];
