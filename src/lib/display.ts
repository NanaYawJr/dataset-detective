import { formatDate, formatNumber, type Region } from './region';
import type { DataType, DateDecision, Role } from './rules/types';

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
  }
}
