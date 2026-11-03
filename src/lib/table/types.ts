import type { ColumnDecision, ColumnFacts, DecidedDateOrder, Finding } from '../rules/types';

/** What the table checks need to know about each column. */
export interface TableColumn {
  name: string;
  sqlName: string;
  facts: ColumnFacts;
  decision: ColumnDecision;
}

/** An expression over the loaded table: a column, or one part of a packed column. */
export interface ColumnExpr {
  label: string;
  sql: string;
  /** For one part of a packed column: the column it is packed in. */
  within?: string;
}

export interface DatePairPlan {
  a: { label: string; sqlName: string; order: DecidedDateOrder };
  b: { label: string; sqlName: string; order: DecidedDateOrder };
}

export interface CoveragePlan {
  label: string;
  sqlName: string;
  order: DecidedDateOrder;
}

export interface TablePlan {
  /** Pairs of columns to test as a two-column key, when no single column is a key. */
  keyPairs: [ColumnExpr, ColumnExpr][];
  /** Pairs to test for "each A has exactly one B", in both directions. */
  dependencyPairs: [ColumnExpr, ColumnExpr][];
  datePairs: DatePairPlan[];
  coverage: CoveragePlan[];
}

export interface DependencyResult {
  from: string;
  to: string;
  /** Distinct non-blank values of `from`. */
  keys: number;
  /** Values of `from` that appear in more than one row, so could map to more than one `to`. */
  repeated: number;
  /** Values of `from` that map to more than one value of `to`. */
  violating: number;
  examples: string[];
  /** Distinct non-blank values of `to`. */
  toDistinct: number;
  /** When both sides are parts of one packed column: that column. */
  within?: string;
}

export interface DatePairResult {
  a: string;
  b: string;
  /** Rows where both dates are present and valid. */
  both: number;
  aBeforeB: number;
  bBeforeA: number;
}

export interface MonthCount {
  /** Year and month as yyyymm. */
  month: number;
  rows: number;
}

export interface CoverageResult {
  column: string;
  months: MonthCount[];
  /** Rows dated after today. */
  future: number;
}

export interface TableResults {
  rows: number;
  duplicateRows: number;
  /** Columns that on their own identify every row. */
  singleKeys: string[];
  /** The first pair of columns that together identify every row, if a pair was needed and found. */
  pairKey: [string, string] | null;
  pairsChecked: number;
  dependencies: DependencyResult[];
  datePairs: DatePairResult[];
  coverage: CoverageResult[];
}

export type TableFindingKind =
  | 'duplicate-rows'
  | 'grain'
  | 'no-key'
  | 'dependency'
  | 'dependency-broken'
  | 'event-order'
  | 'event-order-broken'
  | 'date-gaps'
  | 'future-dates';

export type TableFinding = Omit<Finding, 'kind'> & { kind: TableFindingKind; columns: string[] };

export interface TableReport {
  findings: TableFinding[];
  /** One sentence on what a row represents, when a key was found. */
  grain: string | null;
  coverage: CoverageResult[];
}
