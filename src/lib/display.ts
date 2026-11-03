import { formatDate, formatNumber, type Region } from './region';
import type { DataType, DateDecision, Finding, Role } from './rules/types';
import type { TableFinding, TableReport } from './table/types';

const TYPE_LABELS: Record<DataType, string> = {
  empty: 'Empty',
  integer: 'Whole number',
  decimal: 'Decimal',
  percent: 'Percent',
  currency: 'Currency',
  date: 'Date',
  text: 'Text',
};

const ROLE_LABELS: Record<Role, string> = {
  empty: 'Empty',
  constant: 'Constant',
  identifier: 'Identifier',
  measure: 'Measure',
  date: 'Date',
  category: 'Category',
  'free-text': 'Free text',
  personal: 'Personal data',
};

export const typeLabel = (type: DataType) => TYPE_LABELS[type];
export const roleLabel = (role: Role) => ROLE_LABELS[role];

/** A yyyymmdd integer as a calendar date. */
export function dateFromKey(key: number): Date {
  return new Date(Date.UTC(Math.floor(key / 10000), Math.floor((key % 10000) / 100) - 1, key % 100));
}

export function formatDateKey(key: number, region: Region): string {
  return formatDate(dateFromKey(key), region);
}

/** A measure value in the column's own terms: percent columns keep their % sign. */
export function formatMeasure(value: number, type: DataType, region: Region): string {
  const text = formatNumber(value, region, 2);
  return type === 'percent' ? `${text}%` : text;
}

/** How the date order was decided, in a few words. */
export function describeDateOrder(date: DateDecision, region: Region): string {
  switch (date.basis) {
    case 'iso':
      return 'year-first (ISO)';
    case 'evidence':
      return `${date.order}, proven`;
    case 'other-column':
      return `${date.order}, like ${date.source}`;
    case 'region-suggestion':
      return `${date.order}? suggested for ${region}`;
    case 'unresolved':
      return 'order unknown';
    case 'conflicting':
      return 'mixed orders';
    case 'user':
      return `${date.order}, set by you`;
  }
}

/** A finding ready to show: column findings and whole-table findings in one list. */
export interface ShownFinding {
  key: string;
  /** What the finding is about: a column, a pair of columns, or the whole file. */
  subject: string;
  severity: Finding['severity'];
  title: string;
  detail: string;
  rows?: number;
}

const SEVERITY_ORDER: Record<Finding['severity'], number> = { high: 0, warn: 1, info: 2 };

/** Pairs read as "A → B" when one leads to the other, and "A + B" when together they form a key. */
export function tableSubject(finding: TableFinding): string {
  if (finding.columns.length === 0) return 'Whole file';
  return finding.columns.join(finding.kind === 'grain' ? ' + ' : ' → ');
}

export function allFindings(
  columns: { name: string; decision: { findings: Finding[] } }[],
  table: TableReport | null,
): ShownFinding[] {
  const shown: ShownFinding[] = [
    ...(table?.findings ?? []).map((f, i) => ({
      key: `table-${i}-${f.kind}`,
      subject: tableSubject(f),
      severity: f.severity,
      title: f.title,
      detail: f.detail,
      rows: f.rows,
    })),
    ...columns.flatMap(({ name, decision }) =>
      decision.findings.map((f) => ({
        key: `${name}-${f.kind}`,
        subject: name,
        severity: f.severity,
        title: f.title,
        detail: f.detail,
        rows: f.rows,
      })),
    ),
  ];
  // Stable sort: whole-table findings stay ahead of column findings of the same weight.
  return shown.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (b.rows ?? 0) - (a.rows ?? 0));
}
