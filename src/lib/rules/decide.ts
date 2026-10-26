import { regionInfo, type Region } from '../region';
import type {
  ColumnDecision,
  ColumnFacts,
  DataType,
  DateDecision,
  Finding,
  PersonalDataKind,
  Role,
  Severity,
} from './types';

/**
 * Stage 2: decide each column's type and role from its evidence, and record
 * findings. Every rule is deterministic and every finding states its evidence.
 */

/** Share of values a pattern must cover before a column is treated as that type. */
const TYPE_SHARE = 0.95;
const DATE_SHARE = 0.9;
const PERSONAL_SHARE = 0.8;

const ID_WORD = /(^|[\s_\-.])(id|ref|reference|key|code|number|no|num)$/i;
/** camelCase IDs such as OrderId or customerID. Case-sensitive, so "Paid" and "Valid" don't match. */
const ID_CAMEL = /[a-z](Id|ID)$/;
const PERSON_NAME =
  /(^|[\s_])(first|last|sur|fore|full|given|middle|patient|client)[\s_]?name$|^name$|^surname$|^forename$/i;
const BIRTH_DATE = /(^|[\s_])(dob|date[\s_]?of[\s_]?birth|birth[\s_]?date)$/i;
const NHS_NAME = /nhs/i;

const PERSONAL_LABELS: Record<PersonalDataKind, string> = {
  email: 'email addresses',
  postcode: 'UK postcodes',
  'national-insurance': 'National Insurance numbers',
  'nhs-number': 'NHS numbers',
  phone: 'UK phone numbers',
  name: "people's names",
  'date-of-birth': 'dates of birth',
};

const pct = (share: number) => `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;
const n = (value: number) => value.toLocaleString('en-GB');
const rowsWord = (count: number) => (count === 1 ? '1 row' : `${n(count)} rows`);

function finding(kind: Finding['kind'], severity: Severity, title: string, detail: string, rows?: number): Finding {
  return rows === undefined ? { kind, severity, title, detail } : { kind, severity, title, detail, rows };
}

/** Day/month order for slash dates, from evidence first and the region only as a suggestion. */
export function decideDateOrder(facts: ColumnFacts, region: Region): DateDecision {
  if (facts.isoDates >= facts.slashDates) {
    return { order: 'year-first', basis: 'iso', evidence: facts.isoDates };
  }
  const dayProof = facts.firstPartOver12;
  const monthProof = facts.secondPartOver12;
  if (dayProof > 0 && monthProof > 0) return { order: null, basis: 'conflicting', evidence: dayProof };
  if (dayProof > 0) return { order: 'day-first', basis: 'evidence', evidence: dayProof };
  if (monthProof > 0) return { order: 'month-first', basis: 'evidence', evidence: monthProof };

  // Nothing in the data proves the order. Canada genuinely uses both, so no suggestion there.
  const suggestion = regionInfo(region).defaultDateOrder;
  if (suggestion === 'year-first') return { order: null, basis: 'unresolved', evidence: 0 };
  return { order: suggestion, basis: 'region-suggestion', evidence: 0 };
}

function dateFindings(name: string, facts: ColumnFacts, date: DateDecision, region: Region): Finding[] {
  const found: Finding[] = [];
  const slash = facts.slashDates;
  switch (date.basis) {
    case 'evidence': {
      const order = date.order === 'day-first' ? 'day-first' : 'month-first';
      const part = date.order === 'day-first' ? 'first' : 'second';
      found.push(
        finding(
          'date-order-proven',
          'info',
          `Dates are ${order}`,
          `${n(date.evidence)} values have a ${part} part above 12, which only works as ${order}. Load them with an explicit ${order} format so they read the same on every machine.`,
        ),
      );
      break;
    }
    case 'conflicting':
      found.push(
        finding(
          'date-order-conflict',
          'high',
          'Dates mix day-first and month-first',
          `${n(facts.firstPartOver12)} values only work as day-first and ${n(facts.secondPartOver12)} only work as month-first, so this column mixes two formats. Find out which rows came from which system before using these dates.`,
          slash,
        ),
      );
      break;
    case 'region-suggestion':
    case 'unresolved': {
      const suggestion =
        date.basis === 'region-suggestion'
          ? ` For ${regionInfo(region).label}, ${date.order} is the usual reading, but confirm it with whoever produced the file.`
          : ' In Canada both orders are common, so confirm the order with whoever produced the file.';
      found.push(
        finding(
          'date-order-unproven',
          'warn',
          "Day/month order can't be proven",
          `None of the ${n(slash)} dates in ${name} has a part above 12, so 03/04 could be 3 April or 4 March.${suggestion}`,
          slash,
        ),
      );
      break;
    }
    case 'iso':
      break;
  }
  if (facts.impossibleSlashDates > 0) {
    found.push(
      finding(
        'impossible-dates',
        'warn',
        `${rowsWord(facts.impossibleSlashDates)} can't be valid dates`,
        'These values have both parts above 12, or a zero day or month, so they are not real dates in any order.',
        facts.impossibleSlashDates,
      ),
    );
  }
  if (facts.shortYearDates > 0) {
    found.push(
      finding(
        'two-digit-years',
        'warn',
        'Some dates have two-digit years',
        `${rowsWord(facts.shortYearDates)} use a two-digit year, so 01/02/30 could be 1930 or 2030.`,
        facts.shortYearDates,
      ),
    );
  }
  return found;
}

function numericType(facts: ColumnFacts): DataType {
  const total = facts.filled;
  if (facts.percents / total >= 0.9) return 'percent';
  if (facts.currency / total >= 0.9) return 'currency';
  return facts.integers / facts.numberLike >= 0.99 ? 'integer' : 'decimal';
}

function personalKind(name: string, facts: ColumnFacts, type: DataType): PersonalDataKind | undefined {
  const share = (count: number) => count / facts.filled;
  if (share(facts.emails) >= PERSONAL_SHARE) return 'email';
  if (share(facts.nhsValid) >= PERSONAL_SHARE) return 'nhs-number';
  if (share(facts.niNumbers) >= PERSONAL_SHARE) return 'national-insurance';
  if (share(facts.postcodes) >= PERSONAL_SHARE) return 'postcode';
  if (share(facts.phones) >= PERSONAL_SHARE) return 'phone';
  if (type === 'date' && BIRTH_DATE.test(name.trim())) return 'date-of-birth';
  if (type === 'text' && PERSON_NAME.test(name.trim())) return 'name';
  return undefined;
}

/** "City | Region" split on " | " gives ["City", "Region"]; otherwise numbered parts. */
function splitNames(name: string, separator: '|' | ';' | '/'): [string, string] {
  const parts = name.split(separator).map((p) => p.trim());
  if (parts.length === 2 && parts[0] !== '' && parts[1] !== '') return [parts[0], parts[1]];
  return [`${name} (part 1)`, `${name} (part 2)`];
}

export function decideColumn(name: string, facts: ColumnFacts, rows: number, region: Region): ColumnDecision {
  const empty = rows - facts.filled;
  const findings: Finding[] = [];

  if (facts.filled === 0) {
    return {
      type: 'empty',
      role: 'empty',
      effectivelyMissing: rows,
      findings: [finding('empty-column', 'warn', 'Column is empty', `None of the ${n(rows)} rows has a value.`, rows)],
    };
  }

  const total = facts.filled;
  const share = (count: number) => count / total;
  let type: DataType = 'text';
  let role: Role = 'category';
  let date: DateDecision | undefined;

  // Dates first: "03/04/2026" would otherwise look like text with digits.
  const dateLike = facts.slashDates + facts.isoDates + facts.shortYearDates;
  const numberLikeNonDate = facts.numberLike;
  const codeWithLeadingZeros = facts.leadingZeros > 0 && share(facts.integers) >= TYPE_SHARE;

  if (share(dateLike) >= DATE_SHARE) {
    type = 'date';
    role = 'date';
    date = decideDateOrder(facts, region);
    findings.push(...dateFindings(name, facts, date, region));
  } else if (codeWithLeadingZeros) {
    type = 'text';
    findings.push(
      finding(
        'leading-zeros',
        'info',
        'Codes with leading zeros: keep as text',
        `${rowsWord(facts.leadingZeros)} start with 0 (like 00123). Converting this column to a number would drop the zeros.`,
        facts.leadingZeros,
      ),
    );
  } else if (share(numberLikeNonDate) >= TYPE_SHARE) {
    type = numericType(facts);
    role = 'measure';

    if (type === 'percent' || type === 'currency') {
      const example = type === 'percent' ? '"5%"' : '"£20"';
      const convert = type === 'percent' ? ' (5% becomes 0.05)' : '';
      findings.push(
        finding(
          'numbers-as-text',
          'high',
          'Numbers stored as text',
          `Values are written like ${example}, so most tools read them as text and can't add or average them. Convert them to numbers${convert} before calculating.`,
          facts.numberLike,
        ),
      );
    } else if (facts.thousands > 0) {
      findings.push(
        finding(
          'thousands-separators',
          'warn',
          'Numbers include thousands separators',
          `${rowsWord(facts.thousands)} are written like "1,234". Some tools read these as text; remove the commas when loading.`,
          facts.thousands,
        ),
      );
    }
  }

  // Values in a numeric column that aren't numbers (and aren't known placeholders).
  if (role === 'measure') {
    const strays = total - facts.numberLike - facts.placeholders;
    if (strays > 0) {
      findings.push(
        finding(
          'non-numeric-values',
          'warn',
          `${rowsWord(strays)} aren't numbers`,
          `This column is otherwise numeric. These values will be lost or cause errors when it is converted.`,
          strays,
        ),
      );
    }
  }

  // Identifiers: whole numbers or single-word codes that are (nearly) unique, or named like an ID.
  const uniqueness = facts.distinct / total;
  const codeLike = (type === 'integer' || type === 'text') && facts.withSpaces === 0;
  const namedLikeId = ID_WORD.test(name.trim()) || ID_CAMEL.test(name.trim());
  if (codeLike && ((uniqueness >= TYPE_SHARE && total >= 20) || (namedLikeId && uniqueness >= 0.5))) {
    role = 'identifier';
    if (facts.distinct < total) {
      const repeats = total - facts.distinct;
      findings.push(
        finding(
          'not-unique',
          'warn',
          `${name} repeats in ${rowsWord(repeats)}`,
          `${n(facts.distinct)} distinct values across ${n(total)} rows. If each row should be one record, there are duplicates. More often it means each row is a line within a larger record, so count distinct ${name} values rather than rows.`,
          repeats,
        ),
      );
    }
  } else if (type === 'integer' && role === 'measure' && facts.distinct <= 12) {
    role = 'category';
  }

  if (type === 'text' && role !== 'identifier') {
    role = facts.distinct <= 100 || uniqueness <= 0.05 ? 'category' : 'free-text';
  }

  // Two fields packed into one column.
  if (type === 'text') {
    const separators: ['|' | ';' | '/', number][] = [
      ['|', facts.pipePairs],
      [';', facts.semicolonPairs],
      ['/', facts.slashPairs],
    ];
    const packed = separators.find(([, count]) => share(count) >= TYPE_SHARE);
    if (packed) {
      const [separator] = packed;
      const parts = splitNames(name, separator);
      findings.push(
        finding(
          'packed-field',
          'warn',
          'Two fields in one column',
          `Every value has the form "a ${separator} b". Split it into ${parts[0]} and ${parts[1]} before filtering, grouping or joining on either part.`,
          total,
        ),
      );
      const decision = { separator, parts };
      return finish({ packed: decision });
    }
  }

  return finish({});

  function finish(extra: Partial<ColumnDecision>): ColumnDecision {
    if (facts.distinct === 1) {
      role = 'constant';
      findings.push(
        finding(
          'constant',
          'info',
          'Same value in every row',
          `Every non-blank row holds the same value, so this column can't distinguish rows.`,
        ),
      );
    }

    if (facts.placeholders > 0) {
      const values = facts.placeholderValues.map((v) => `"${v}"`).join(', ');
      findings.push(
        finding(
          'placeholders',
          'warn',
          'Placeholder values hide missing data',
          `${values} ${facts.placeholderValues.length === 1 ? 'stands' : 'stand'} in for a missing value in ${rowsWord(facts.placeholders)} (${pct(facts.placeholders / rows)}), so the blank count understates what is missing.`,
          facts.placeholders,
        ),
      );
    }

    if (share(facts.numberedLabels) >= TYPE_SHARE && facts.distinct <= 20 && facts.distinct > 1) {
      findings.push(
        finding(
          'rank-in-text',
          'info',
          'Rank encoded in the text',
          'Every value starts with a number (like "1-Urgent"). Extract the number as a sort key instead of relying on alphabetical order.',
        ),
      );
    }

    const personal = personalKind(name, facts, type);
    if (personal) {
      role = 'personal';
      findings.push(
        finding(
          'personal-data',
          'warn',
          `Personal data: ${PERSONAL_LABELS[personal]}`,
          personal === 'name' || personal === 'date-of-birth'
            ? `The column name suggests ${PERSONAL_LABELS[personal]}. Treat this file as personal data.`
            : `${pct(share(personalCount(personal)))} of values look like ${PERSONAL_LABELS[personal]}. Treat this file as personal data.`,
        ),
      );
    } else if (NHS_NAME.test(name) && share(facts.nhsShaped) >= TYPE_SHARE && facts.nhsValid < facts.nhsShaped) {
      const invalid = facts.nhsShaped - facts.nhsValid;
      findings.push(
        finding(
          'invalid-nhs-numbers',
          'warn',
          `${rowsWord(invalid)} fail the NHS number check digit`,
          'These look like NHS numbers but their tenth digit is wrong, which usually means a typing or transcription error.',
          invalid,
        ),
      );
    }

    const missing = empty + facts.placeholders;
    if (missing / rows >= 0.5) {
      findings.push(
        finding(
          'mostly-blank',
          'warn',
          'Mostly missing',
          `${pct(missing / rows)} of rows are blank or hold a placeholder.`,
          missing,
        ),
      );
    }

    return { type, role, date, personal, ...extra, effectivelyMissing: missing, findings };
  }

  function personalCount(kind: PersonalDataKind): number {
    switch (kind) {
      case 'email':
        return facts.emails;
      case 'nhs-number':
        return facts.nhsValid;
      case 'national-insurance':
        return facts.niNumbers;
      case 'postcode':
        return facts.postcodes;
      case 'phone':
        return facts.phones;
      default:
        return 0;
    }
  }
}

/**
 * Decides every column, then lets a column whose dates prove their order
 * settle the order for date columns in the same file that can't prove it
 * themselves, as long as no column proves the opposite.
 */
export function decideColumns(
  columns: { name: string; facts: ColumnFacts }[],
  rows: number,
  region: Region,
): { name: string; decision: ColumnDecision }[] {
  const decided = columns.map(({ name, facts }) => ({
    name,
    facts,
    decision: decideColumn(name, facts, rows, region),
  }));

  const proven = decided.filter(({ decision }) => decision.date?.basis === 'evidence');
  const orders = new Set(proven.map(({ decision }) => decision.date?.order));
  const conflicting = decided.some(({ decision }) => decision.date?.basis === 'conflicting');

  if (orders.size === 1 && !conflicting) {
    const source = proven[0];
    const order = source.decision.date!.order!;
    for (const column of decided) {
      const date = column.decision.date;
      if (!date || (date.basis !== 'region-suggestion' && date.basis !== 'unresolved')) continue;
      column.decision.date = { order, basis: 'other-column', evidence: 0, source: source.name };
      column.decision.findings = column.decision.findings.map((f) =>
        f.kind === 'date-order-unproven'
          ? finding(
              'date-order-inferred',
              'info',
              `Dates read as ${order}, like ${source.name}`,
              `No value in ${column.name} proves the order on its own, but ${source.name} is ${order} (${n(source.decision.date!.evidence)} values prove it), and columns in one file almost always share a format.`,
            )
          : f,
      );
    }
  }

  return decided.map(({ name, decision }) => ({ name, decision }));
}

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, warn: 1, info: 2 };

/** All findings across columns, most severe first, then by rows affected. */
export function rankFindings(columns: { name: string; decision: ColumnDecision }[]) {
  return columns
    .flatMap(({ name, decision }) => decision.findings.map((f) => ({ column: name, ...f })))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (b.rows ?? 0) - (a.rows ?? 0));
}
