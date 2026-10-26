/**
 * Patterns shared by the SQL that gathers evidence and the rules that
 * interpret it. Regular expressions use RE2 syntax (DuckDB's engine) and
 * are matched against the whole value.
 */

export const PATTERNS = {
  integer: String.raw`[-+]?\d+`,
  plainNumber: String.raw`[-+]?(\d+(\.\d+)?|\.\d+)`,
  /** Numbers as people write them: 1,234.50  £20  -3.5  5% */
  numberLike: String.raw`[-+]?[£$€]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?%?`,
  currencyPrefix: String.raw`^[-+]?[£$€]`,
  thousandsSeparator: String.raw`\d,\d{3}`,
  leadingZero: String.raw`0\d+`,

  /** 03/04/2026, 3-4-2026, 03.04.2026, optionally with a time. Groups: 1 first part, 2 second part, 3 year. */
  slashDate: String.raw`(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})([ T]\d{1,2}:\d{2}(:\d{2})?)?`,
  /** 03/04/26: two-digit year. */
  shortYearDate: String.raw`\d{1,2}[/.-]\d{1,2}[/.-]\d{2}`,
  /** 2026-04-03, optionally with a time. Groups: 1 year, 2 month, 3 day. */
  isoDate: String.raw`(\d{4})-(\d{1,2})-(\d{1,2})([ T]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?Z?)?`,

  /** Exactly one separator with text on both sides. */
  pipePair: String.raw`[^|]*[^|\s][^|]*\|[^|]*[^|\s][^|]*`,
  semicolonPair: String.raw`[^;]*[^;\s][^;]*;[^;]*[^;\s][^;]*`,
  slashPair: String.raw`[^/]*\S\s+/\s+\S[^/]*`,

  /** "1-Urgent", "2. High", "3) Medium" */
  numberedLabel: String.raw`\d{1,2}\s*[-.):]\s*[A-Za-z].*`,
  /** Prefix stripped before checking for placeholder words, so "4-Not Specified" is caught. */
  labelPrefix: String.raw`^\d{1,2}\s*[-.):]\s*`,

  email: String.raw`[^@\s]+@[^@\s]+\.[A-Za-z]{2,}`,
  ukPostcode: String.raw`(?i)[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}`,
  niNumber: String.raw`(?i)[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]`,
  ukPhone: String.raw`(\+44\s?(\(0\)\s?)?|0)\d([\s-]?\d){8,9}`,
  nhsShape: String.raw`\d{3}[\s-]?\d{3}[\s-]?\d{4}`,
} as const;

/** Words and codes commonly used to mean "no value". Compared in lower case. */
export const PLACEHOLDER_WORDS = [
  'n/a',
  'na',
  '#n/a',
  'null',
  'none',
  'nil',
  'nan',
  'undefined',
  '-',
  '--',
  '---',
  '?',
  '.',
  'unknown',
  'not known',
  'not specified',
  'unspecified',
  'not applicable',
  'not recorded',
  'not stated',
  'not available',
  'no data',
  'missing',
  'blank',
  'tbc',
  'tba',
] as const;

/** Dates used as stand-ins for "no date". */
export const PLACEHOLDER_DATES = [
  '1900-01-01',
  '01/01/1900',
  '1/1/1900',
  '0001-01-01',
  '01/01/0001',
  '9999-12-31',
  '31/12/9999',
  '12/31/9999',
  '0000-00-00',
] as const;

/** Mirrors the SQL check, for tests and for re-checking values in the browser. */
export function isPlaceholder(value: string): boolean {
  const raw = value.trim().toLowerCase();
  const label = raw.replace(new RegExp(PATTERNS.labelPrefix), '').trim();
  return (
    (PLACEHOLDER_WORDS as readonly string[]).includes(raw) ||
    (PLACEHOLDER_WORDS as readonly string[]).includes(label) ||
    (PLACEHOLDER_DATES as readonly string[]).includes(raw)
  );
}
