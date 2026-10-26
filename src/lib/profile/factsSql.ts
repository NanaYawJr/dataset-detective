import { nhsChecksumSql } from '../rules/nhs';
import { PATTERNS, PLACEHOLDER_DATES, PLACEHOLDER_WORDS } from '../rules/patterns';
import type { ColumnDecision, ColumnFacts } from '../rules/types';
import { quoteIdent, quoteLiteral } from './sql';

/**
 * SQL that turns the loaded table into evidence.
 *
 * Step 1 (valueCountsSql) unpivots the table once into a temporary table of
 * (column_name, v, n): each distinct non-blank value per column and how many
 * rows hold it. Every later query reads that table, so each check runs once
 * per distinct value rather than once per row, and counts are weighted by n.
 */

const lit = quoteLiteral;
const list = (values: readonly string[]) => values.map(lit).join(', ');

export const VALUE_COUNTS = 'value_counts';

export function valueCountsSql(table: string): string {
  return `CREATE OR REPLACE TEMP TABLE ${VALUE_COUNTS} AS
SELECT column_name, v, count(*) AS n
FROM (UNPIVOT ${quoteIdent(table)} ON COLUMNS(*) INTO NAME column_name VALUE v)
WHERE trim(v) <> ''
GROUP BY column_name, v`;
}

/** Runs the regular expression only when a cheap pre-check passes. */
const when = (precheck: string, pattern: string) =>
  `CASE WHEN ${precheck} THEN regexp_full_match(t, ${lit(pattern)}) ELSE false END`;
const startsWithDigit = `left(t, 1) BETWEEN '0' AND '9'`;
const NUMBER_START = `left(t, 1) IN ('0','1','2','3','4','5','6','7','8','9','-','+','.','£','$','€')`;
const part = (group: number) =>
  `CASE WHEN is_slash_date THEN TRY_CAST(regexp_extract(t, ${lit(PATTERNS.slashDate)}, ${group}) AS INTEGER) END`;

export function columnFactsSql(): string {
  const label = `lower(trim(regexp_replace(t, ${lit(PATTERNS.labelPrefix)}, '')))`;
  const placeholder = `CASE WHEN length(t) <= 25 THEN (lower(t) IN (${list(PLACEHOLDER_WORDS)}) OR ${label} IN (${list(PLACEHOLDER_WORDS)}) OR lower(t) IN (${list(PLACEHOLDER_DATES)})) ELSE false END`;

  return `WITH classified AS (
  SELECT *,
    ${when('is_number_like', PATTERNS.integer)} AS is_integer,
    ${when('is_number_like', PATTERNS.plainNumber)} AS is_plain_number,
    ${part(1)} AS first_part,
    ${part(2)} AS second_part
  FROM (
    SELECT column_name, v, n, t,
      contains(t, ' ') AS has_space,
      ${when(NUMBER_START, PATTERNS.numberLike)} AS is_number_like,
      ${when(`${startsWithDigit} AND length(t) BETWEEN 8 AND 25`, PATTERNS.slashDate)} AS is_slash_date,
      ${when(`${startsWithDigit} AND length(t) BETWEEN 6 AND 8`, PATTERNS.shortYearDate)} AS is_short_year_date,
      ${when(`${startsWithDigit} AND length(t) BETWEEN 8 AND 35`, PATTERNS.isoDate)} AS is_iso_date,
      ${when(`contains(t, '|')`, PATTERNS.pipePair)} AS is_pipe_pair,
      ${when(`contains(t, ';')`, PATTERNS.semicolonPair)} AS is_semicolon_pair,
      ${when(`contains(t, ' / ')`, PATTERNS.slashPair)} AS is_slash_pair,
      ${placeholder} AS is_placeholder,
      ${when(startsWithDigit, PATTERNS.numberedLabel)} AS is_numbered_label,
      ${when(`contains(t, '@')`, PATTERNS.email)} AS is_email,
      ${when('length(t) BETWEEN 5 AND 8', PATTERNS.ukPostcode)} AS is_postcode,
      ${when('length(t) BETWEEN 9 AND 13', PATTERNS.niNumber)} AS is_ni_number,
      ${when(`(starts_with(t, '0') OR starts_with(t, '+')) AND length(t) BETWEEN 10 AND 17`, PATTERNS.ukPhone)} AS is_phone,
      ${when('length(t) BETWEEN 10 AND 12', PATTERNS.nhsShape)} AS is_nhs_shaped
    FROM (SELECT column_name, v, n, trim(v) AS t FROM ${VALUE_COUNTS})
  )
)
SELECT
  column_name,
  sum(n) AS filled,
  count(*) AS distinct_values,
  min(length(v)) AS min_length,
  max(length(v)) AS max_length,
  coalesce(sum(n) FILTER (WHERE has_space), 0) AS with_spaces,
  coalesce(sum(n) FILTER (WHERE is_integer), 0) AS integers,
  coalesce(sum(n) FILTER (WHERE is_plain_number), 0) AS plain_numbers,
  coalesce(sum(n) FILTER (WHERE is_number_like), 0) AS number_like,
  coalesce(sum(n) FILTER (WHERE is_number_like AND suffix(t, '%')), 0) AS percents,
  coalesce(sum(n) FILTER (WHERE is_number_like AND regexp_matches(t, ${lit(PATTERNS.currencyPrefix)})), 0) AS currency,
  coalesce(sum(n) FILTER (WHERE is_number_like AND contains(t, ',')), 0) AS thousands,
  coalesce(sum(n) FILTER (WHERE is_integer AND starts_with(t, '0') AND length(t) > 1), 0) AS leading_zeros,
  coalesce(sum(n) FILTER (WHERE is_slash_date), 0) AS slash_dates,
  coalesce(sum(n) FILTER (WHERE first_part > 12 AND second_part <= 12), 0) AS first_over_12,
  coalesce(sum(n) FILTER (WHERE second_part > 12 AND first_part <= 12), 0) AS second_over_12,
  coalesce(sum(n) FILTER (WHERE (first_part > 12 AND second_part > 12) OR first_part = 0 OR second_part = 0), 0) AS impossible_slash_dates,
  coalesce(sum(n) FILTER (WHERE is_short_year_date), 0) AS short_year_dates,
  coalesce(sum(n) FILTER (WHERE is_iso_date), 0) AS iso_dates,
  coalesce(sum(n) FILTER (WHERE is_pipe_pair), 0) AS pipe_pairs,
  coalesce(sum(n) FILTER (WHERE is_semicolon_pair), 0) AS semicolon_pairs,
  coalesce(sum(n) FILTER (WHERE is_slash_pair), 0) AS slash_pairs,
  coalesce(sum(n) FILTER (WHERE is_placeholder), 0) AS placeholders,
  list(v ORDER BY v) FILTER (WHERE is_placeholder) AS placeholder_values,
  coalesce(sum(n) FILTER (WHERE is_numbered_label), 0) AS numbered_labels,
  coalesce(sum(n) FILTER (WHERE is_email), 0) AS emails,
  coalesce(sum(n) FILTER (WHERE is_postcode), 0) AS postcodes,
  coalesce(sum(n) FILTER (WHERE is_ni_number), 0) AS ni_numbers,
  coalesce(sum(n) FILTER (WHERE is_phone), 0) AS phones,
  coalesce(sum(n) FILTER (WHERE is_nhs_shaped), 0) AS nhs_shaped,
  coalesce(sum(n) FILTER (WHERE is_nhs_shaped AND ${nhsChecksumSql('t')}), 0) AS nhs_valid
FROM classified
GROUP BY column_name`;
}

type Row = Record<string, unknown>;

const num = (value: unknown): number => (typeof value === 'bigint' ? Number(value) : Number(value ?? 0));
const nullableNum = (value: unknown): number | null => (value === null || value === undefined ? null : num(value));

function stringList(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.map(String);
  // DuckDB-WASM returns lists as Arrow vectors, which are iterable.
  if (typeof value === 'object' && Symbol.iterator in value) return Array.from(value as Iterable<unknown>, String);
  return [];
}

/** Maps one row of columnFactsSql output to ColumnFacts. */
export function toColumnFacts(row: Row): ColumnFacts {
  return {
    filled: num(row.filled),
    distinct: num(row.distinct_values),
    minLength: nullableNum(row.min_length),
    maxLength: nullableNum(row.max_length),
    withSpaces: num(row.with_spaces),
    integers: num(row.integers),
    plainNumbers: num(row.plain_numbers),
    numberLike: num(row.number_like),
    percents: num(row.percents),
    currency: num(row.currency),
    thousands: num(row.thousands),
    leadingZeros: num(row.leading_zeros),
    slashDates: num(row.slash_dates),
    firstPartOver12: num(row.first_over_12),
    secondPartOver12: num(row.second_over_12),
    impossibleSlashDates: num(row.impossible_slash_dates),
    shortYearDates: num(row.short_year_dates),
    isoDates: num(row.iso_dates),
    pipePairs: num(row.pipe_pairs),
    semicolonPairs: num(row.semicolon_pairs),
    slashPairs: num(row.slash_pairs),
    placeholders: num(row.placeholders),
    placeholderValues: stringList(row.placeholder_values),
    numberedLabels: num(row.numbered_labels),
    emails: num(row.emails),
    postcodes: num(row.postcodes),
    niNumbers: num(row.ni_numbers),
    phones: num(row.phones),
    nhsShaped: num(row.nhs_shaped),
    nhsValid: num(row.nhs_valid),
  };
}

/** Top values for every column, from the value counts. */
export function topValuesAllSql(limit = 5): string {
  return `SELECT column_name, v AS value, n FROM (
  SELECT column_name, v, n, row_number() OVER (PARTITION BY column_name ORDER BY n DESC, v) AS rank
  FROM ${VALUE_COUNTS}
) WHERE rank <= ${limit}
ORDER BY column_name, rank`;
}

/** Value shapes for every column: digits become 9, letters A. Computed once per distinct value. */
export function shapesAllSql(limit = 3): string {
  return `SELECT column_name, shape AS value, n FROM (
  SELECT column_name, shape, sum(n) AS n,
    row_number() OVER (PARTITION BY column_name ORDER BY sum(n) DESC, shape) AS rank
  FROM (
    SELECT column_name, n,
      left(regexp_replace(regexp_replace(v, '[0-9]', '9', 'g'), '[A-Za-z]', 'A', 'g'), 40) AS shape
    FROM ${VALUE_COUNTS}
  )
  GROUP BY column_name, shape
) WHERE rank <= ${limit}
ORDER BY column_name, rank`;
}

/** A value as a number: thousands separators, currency symbols and % removed. */
function numericValue(column: string): string {
  const c = quoteIdent(column);
  return `TRY_CAST(regexp_replace(trim(${c}), '[,£$€%]', '', 'g') AS DOUBLE)`;
}

/**
 * A slash or ISO date as an integer yyyymmdd, using the decided order.
 * Invalid dates (month above 12, day above 31) become NULL.
 */
function dateKey(column: string, order: 'day-first' | 'month-first' | 'year-first'): string {
  const c = `trim(${quoteIdent(column)})`;
  const pattern = order === 'year-first' ? PATTERNS.isoDate : PATTERNS.slashDate;
  const g = (n: number) => `TRY_CAST(regexp_extract(${c}, ${lit(pattern)}, ${n}) AS INTEGER)`;
  const [year, month, day] =
    order === 'year-first' ? [g(1), g(2), g(3)] : order === 'day-first' ? [g(3), g(2), g(1)] : [g(3), g(1), g(2)];
  return `CASE WHEN regexp_full_match(${c}, ${lit(pattern)}) AND ${month} BETWEEN 1 AND 12 AND ${day} BETWEEN 1 AND 31
    THEN ${year} * 10000 + ${month} * 100 + ${day} END`;
}

export interface TypedColumn {
  name: string;
  decision: ColumnDecision;
}

/**
 * One query for the statistics that only make sense once a column's type is
 * known: min/max/mean/median/std dev for measures, earliest and latest dates
 * for dates. Returns null when no column needs it.
 */
export function typedStatsSql(table: string, columns: TypedColumn[]): string | null {
  const selects: string[] = [];
  columns.forEach(({ name, decision }, i) => {
    const numeric = ['integer', 'decimal', 'percent', 'currency'].includes(decision.type);
    if (numeric && decision.role === 'measure') {
      const x = numericValue(name);
      selects.push(
        `min(${x}) AS n${i}_min`,
        `max(${x}) AS n${i}_max`,
        `avg(${x}) AS n${i}_mean`,
        `median(${x}) AS n${i}_median`,
        `stddev_samp(${x}) AS n${i}_std`,
      );
    }
    if (decision.type === 'date' && decision.date?.order) {
      const key = dateKey(name, decision.date.order);
      selects.push(`min(${key}) AS d${i}_min`, `max(${key}) AS d${i}_max`);
    }
  });
  return selects.length === 0 ? null : `SELECT\n  ${selects.join(',\n  ')}\nFROM ${quoteIdent(table)}`;
}
