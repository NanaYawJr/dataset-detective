/**
 * Evidence gathered for one column in a single pass over the data.
 * Every count is over non-blank values only.
 */
export interface ColumnFacts {
  filled: number;
  distinct: number;
  minLength: number | null;
  maxLength: number | null;
  withSpaces: number;

  integers: number;
  plainNumbers: number;
  numberLike: number;
  percents: number;
  currency: number;
  thousands: number;
  leadingZeros: number;

  slashDates: number;
  /** Slash dates whose first part is above 12: only possible if day-first. */
  firstPartOver12: number;
  /** Slash dates whose second part is above 12: only possible if month-first. */
  secondPartOver12: number;
  /** Slash dates where both parts are above 12, or either is zero: not a date either way. */
  impossibleSlashDates: number;
  shortYearDates: number;
  isoDates: number;

  pipePairs: number;
  semicolonPairs: number;
  slashPairs: number;

  placeholders: number;
  placeholderValues: string[];
  numberedLabels: number;

  emails: number;
  postcodes: number;
  niNumbers: number;
  phones: number;
  nhsShaped: number;
  nhsValid: number;
}

export type DataType = 'empty' | 'integer' | 'decimal' | 'percent' | 'currency' | 'date' | 'text';

export type Role = 'empty' | 'constant' | 'identifier' | 'measure' | 'date' | 'category' | 'free-text' | 'personal';

export type PersonalDataKind =
  'email' | 'postcode' | 'national-insurance' | 'nhs-number' | 'phone' | 'name' | 'date-of-birth';

export type DecidedDateOrder = 'day-first' | 'month-first' | 'year-first';

export interface DateDecision {
  /** null when the order can't be decided: the user has to say. */
  order: DecidedDateOrder | null;
  basis: 'evidence' | 'iso' | 'region-suggestion' | 'unresolved' | 'conflicting' | 'other-column';
  /** Values that prove the chosen order (or, when conflicting, the day-first count). */
  evidence: number;
  /** For 'other-column': the column whose dates proved the order. */
  source?: string;
}

export type Severity = 'high' | 'warn' | 'info';

export type FindingKind =
  | 'empty-column'
  | 'mostly-blank'
  | 'constant'
  | 'numbers-as-text'
  | 'thousands-separators'
  | 'non-numeric-values'
  | 'leading-zeros'
  | 'not-unique'
  | 'date-order-proven'
  | 'date-order-unproven'
  | 'date-order-inferred'
  | 'date-order-conflict'
  | 'impossible-dates'
  | 'two-digit-years'
  | 'packed-field'
  | 'placeholders'
  | 'rank-in-text'
  | 'personal-data'
  | 'invalid-nhs-numbers';

export interface Finding {
  kind: FindingKind;
  severity: Severity;
  title: string;
  detail: string;
  /** Rows the finding applies to, when that can be counted. */
  rows?: number;
}

export interface ColumnDecision {
  type: DataType;
  role: Role;
  date?: DateDecision;
  personal?: PersonalDataKind;
  packed?: { separator: '|' | ';' | '/'; parts: [string, string] };
  /** Blank rows plus placeholder rows. */
  effectivelyMissing: number;
  findings: Finding[];
}
