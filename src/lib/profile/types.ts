import type { FormatReport } from '../format/detectFormat';
import type { Region } from '../region';
import type { ColumnDecision, ColumnFacts, Overrides } from '../rules/types';
import type { TableReport } from '../table/types';

export type Scope = 'full' | 'sample';

export interface ValueCount {
  value: string;
  count: number;
}

export interface MeasureStats {
  min: number;
  max: number;
  mean: number;
  median: number;
  /** Sample standard deviation; null with fewer than two values. */
  std: number | null;
}

export interface DateRange {
  /** Earliest and latest dates as yyyymmdd integers. */
  first: number;
  last: number;
}

export interface ColumnStats {
  /** Name shown to the user. */
  name: string;
  /** Name of the column in the in-browser database. */
  sqlName: string;
  /** Rows with a non-blank value. */
  filled: number;
  /** Rows that are NULL or only whitespace. */
  empty: number;
  distinct: number;
  minLength: number | null;
  maxLength: number | null;
  topValues: ValueCount[];
  shapes: ValueCount[];
  facts: ColumnFacts;
  decision: ColumnDecision;
  measure?: MeasureStats;
  dateRange?: DateRange;
}

export interface ProfileResult {
  fileName: string;
  fileSize: number;
  format: FormatReport;
  scope: Scope;
  /** Region used when deciding the columns (it affects unproven date orders). */
  region: Region;
  /** Rows in the whole file (after any skipped broken rows). */
  totalRows: number;
  /** Rows actually profiled: equals totalRows unless a sample was taken. */
  profiledRows: number;
  /** Rows DuckDB skipped because they were broken (only when the user chose to skip them). */
  skippedRows: number;
  columns: ColumnStats[];
  /** Checks across rows and columns: duplicates, keys, dependencies, dates. */
  table: TableReport | null;
  /** Corrections the user has made, by column name. */
  overrides: Overrides;
  profiledAt: Date;
  durationMs: number;
}

export type Step = 'read-sample' | 'detect-format' | 'load' | 'evidence' | 'decide' | 'stats' | 'table';

export const STEP_LABELS: Record<Step, string> = {
  'read-sample': 'Reading the start of the file',
  'detect-format': 'Detecting encoding, delimiter and header row',
  load: 'Loading into the in-browser database',
  evidence: 'Gathering evidence from every value',
  decide: "Deciding each column's type and role",
  stats: 'Computing statistics, top values and shapes',
  table: 'Checking rows and columns against each other',
};

export const STEPS: Step[] = ['read-sample', 'detect-format', 'load', 'evidence', 'decide', 'stats', 'table'];
