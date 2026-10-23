/**
 * Region setting. It controls how dates and numbers are shown, and (from
 * the date checks onwards) which date order is suggested when a file's
 * dates can't prove their own order.
 *
 * Dates are never shown as ambiguous slash dates like 03/04/2026.
 */

export type Region = 'UK' | 'CA' | 'US';
export type DateOrder = 'day-first' | 'month-first' | 'year-first';

export interface RegionInfo {
  id: Region;
  label: string;
  /** BCP 47 locale, also used in generated Power Query code. */
  locale: 'en-GB' | 'en-CA' | 'en-US';
  /** Suggested order when the evidence in a file is inconclusive. */
  defaultDateOrder: DateOrder;
  example: string;
}

export const REGIONS: readonly RegionInfo[] = [
  { id: 'UK', label: 'United Kingdom', locale: 'en-GB', defaultDateOrder: 'day-first', example: '21 Oct 2026' },
  { id: 'CA', label: 'Canada', locale: 'en-CA', defaultDateOrder: 'year-first', example: '2026-10-21' },
  { id: 'US', label: 'United States', locale: 'en-US', defaultDateOrder: 'month-first', example: 'Oct 21, 2026' },
];

export const DEFAULT_REGION: Region = 'UK';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function regionInfo(region: Region): RegionInfo {
  return REGIONS.find((r) => r.id === region) ?? REGIONS[0];
}

export function isRegion(value: unknown): value is Region {
  return value === 'UK' || value === 'CA' || value === 'US';
}

/** Formats a calendar date (using its UTC parts) for display. */
export function formatDate(date: Date, region: Region): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  switch (region) {
    case 'UK':
      return `${d} ${MONTHS[m]} ${y}`;
    case 'CA':
      return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    case 'US':
      return `${MONTHS[m]} ${d}, ${y}`;
  }
}

export function formatNumber(value: number, region: Region, maximumFractionDigits = 2): string {
  return new Intl.NumberFormat(regionInfo(region).locale, { maximumFractionDigits }).format(value);
}

export function formatPercent(share: number, region: Region): string {
  return new Intl.NumberFormat(regionInfo(region).locale, {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(share);
}

const STORAGE_KEY = 'dataset-detective:region';

/** Remembered per browser; falls back to the default if storage is unavailable. */
export function loadRegion(): Region {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isRegion(stored) ? stored : DEFAULT_REGION;
  } catch {
    return DEFAULT_REGION;
  }
}

export function saveRegion(region: Region): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, region);
  } catch {
    // Private browsing or blocked storage: the choice just won't be remembered.
  }
}
