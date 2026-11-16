import { formatDateKey, formatMeasure, roleLabel, typeLabel } from '../display';
import type { ColumnStats, ProfileResult } from '../profile/types';
import { formatNumber, type Region } from '../region';
import type { Severity } from '../rules/types';
import type { ColumnChange, ColumnComparison, Comparison, FindingChange, ValueSetDiff } from './types';

/**
 * Compares two profiles of what should be the same kind of file: an
 * earlier delivery and the current one. Pure, so it is tested directly.
 * Everything is described as a change from the earlier file to the current.
 */

type Profile = Pick<ProfileResult, 'columns' | 'profiledRows' | 'table'>;

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, warn: 1, info: 2 };
/** Missing values: report a change of at least one percentage point. */
const MISSING_NOTABLE = 0.01;
const MISSING_SERIOUS = 0.05;
/** Averages: report a shift of at least 10%, and warn from 25%. */
const MEAN_NOTABLE = 0.1;
const MEAN_SERIOUS = 0.25;
const ROWS_SERIOUS_DROP = 0.1;

/** Names that differ only in case, spaces or punctuation are treated as the same column renamed. */
const normalise = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '');
const percent = (share: number) => `${(share * 100).toFixed(share > 0 && share < 0.1 ? 1 : 0)}%`;
const quotedList = (values: string[], max = 4) => {
  const shown = values.slice(0, max).map((v) => `"${v}"`);
  const more = values.length - shown.length;
  return more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(', ');
};

function missingShare(column: ColumnStats, rows: number): number {
  return rows === 0 ? 0 : column.decision.effectivelyMissing / rows;
}

function compareColumn(
  now: ColumnStats,
  before: ColumnStats,
  rows: { current: number; earlier: number },
  values: ValueSetDiff | undefined,
  region: Region,
): ColumnChange[] {
  const changes: ColumnChange[] = [];
  const add = (severity: Severity, text: string) => changes.push({ severity, text });
  const n = (value: number) => formatNumber(value, region);

  if (now.decision.type !== before.decision.type) {
    add(
      'high',
      `Type changed from ${typeLabel(before.decision.type).toLowerCase()} to ${typeLabel(now.decision.type).toLowerCase()}. Anything built on the old type will break or silently misread it.`,
    );
  } else if (now.decision.role !== before.decision.role) {
    add(
      'info',
      `Now treated as ${roleLabel(now.decision.role).toLowerCase()}; it was ${roleLabel(before.decision.role).toLowerCase()}.`,
    );
  }

  const beforeOrder = before.decision.date?.order;
  const nowOrder = now.decision.date?.order;
  if (beforeOrder && nowOrder && beforeOrder !== nowOrder) {
    add('high', `Dates are now ${nowOrder}; they were ${beforeOrder}. The same text now means a different date.`);
  }

  const missingNow = missingShare(now, rows.current);
  const missingBefore = missingShare(before, rows.earlier);
  const missingChange = missingNow - missingBefore;
  if (Math.abs(missingChange) >= MISSING_NOTABLE || (missingBefore === 0) !== (missingNow === 0)) {
    if (missingChange > 0) {
      add(
        missingChange >= MISSING_SERIOUS || missingBefore === 0 ? 'warn' : 'info',
        missingBefore === 0
          ? `Now has missing values: ${percent(missingNow)} of rows. It had none.`
          : `More values are missing: ${percent(missingNow)} of rows, up from ${percent(missingBefore)}.`,
      );
    } else {
      add(
        'info',
        missingNow === 0
          ? `No longer has missing values (it was ${percent(missingBefore)}).`
          : `Fewer values are missing: ${percent(missingNow)} of rows, down from ${percent(missingBefore)}.`,
      );
    }
  }

  if (values) {
    if (values.added.length > 0) {
      add(
        'warn',
        `${values.added.length === 1 ? 'A new value' : `${values.added.length} new values`}: ${quotedList(values.added)}. Reports that group by this column may need updating.`,
      );
    }
    if (values.removed.length > 0) {
      add(
        'info',
        `${values.removed.length === 1 ? 'A value no longer appears' : `${values.removed.length} values no longer appear`}: ${quotedList(values.removed)}.`,
      );
    }
  }

  if (now.measure && before.measure && before.measure.mean !== 0) {
    const shift = (now.measure.mean - before.measure.mean) / Math.abs(before.measure.mean);
    if (Math.abs(shift) >= MEAN_NOTABLE) {
      const type = now.decision.type;
      add(
        Math.abs(shift) >= MEAN_SERIOUS ? 'warn' : 'info',
        `The average ${shift > 0 ? 'rose' : 'fell'} ${percent(Math.abs(shift))}, from ${formatMeasure(before.measure.mean, type, region)} to ${formatMeasure(now.measure.mean, type, region)}.`,
      );
    }
    if (now.measure.max > before.measure.max && now.measure.max > before.measure.max * 2 && before.measure.max > 0) {
      add(
        'warn',
        `The largest value is now ${formatMeasure(now.measure.max, now.decision.type, region)}, more than double the earlier ${formatMeasure(before.measure.max, now.decision.type, region)}. Check for an outlier or a change of unit.`,
      );
    }
  }

  if (now.dateRange && before.dateRange) {
    if (now.dateRange.last < before.dateRange.last) {
      add(
        'warn',
        `The latest date moved back to ${formatDateKey(now.dateRange.last, region)}; it was ${formatDateKey(before.dateRange.last, region)}. Recent rows may be missing.`,
      );
    } else if (now.dateRange.last > before.dateRange.last) {
      add(
        'info',
        `Now runs to ${formatDateKey(now.dateRange.last, region)}; it ran to ${formatDateKey(before.dateRange.last, region)}.`,
      );
    }
    if (now.dateRange.first > before.dateRange.first) {
      add(
        'info',
        `Now starts at ${formatDateKey(now.dateRange.first, region)}; it started at ${formatDateKey(before.dateRange.first, region)}. Earlier rows are no longer included.`,
      );
    }
  }

  // An identifier that was unique and no longer is.
  const wasUnique = before.facts.distinct === before.facts.filled && before.facts.filled > 1;
  const isUnique = now.facts.distinct === now.facts.filled;
  if (wasUnique && !isUnique && now.decision.role === 'identifier') {
    add(
      'high',
      `Was different on every row and now repeats in ${n(now.facts.filled - now.facts.distinct)} rows. Joins on it can now double-count.`,
    );
  }

  return changes.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

function findingKeys(profile: Profile): Map<string, FindingChange> {
  const found = new Map<string, FindingChange>();
  for (const column of profile.columns) {
    for (const finding of column.decision.findings) {
      if (finding.severity === 'info') continue;
      found.set(`${column.name}\u0000${finding.kind}`, {
        column: column.name,
        title: finding.title,
        severity: finding.severity,
      });
    }
  }
  for (const finding of profile.table?.findings ?? []) {
    if (finding.severity === 'info') continue;
    const subject = finding.columns.join(' → ') || 'Whole file';
    found.set(`${subject}\u0000${finding.kind}`, { column: subject, title: finding.title, severity: finding.severity });
  }
  return found;
}

export function compareProfiles(
  current: Profile,
  earlier: Profile,
  values: ValueSetDiff[],
  region: Region,
): Comparison {
  const n = (value: number) => formatNumber(value, region);
  const before = new Map(earlier.columns.map((c) => [c.name, c]));
  const now = new Map(current.columns.map((c) => [c.name, c]));

  let added = current.columns.filter((c) => !before.has(c.name)).map((c) => c.name);
  let removed = earlier.columns.filter((c) => !now.has(c.name)).map((c) => c.name);
  const renamed: { from: string; to: string }[] = [];
  for (const to of [...added]) {
    const from = removed.find((name) => normalise(name) === normalise(to));
    if (from) {
      renamed.push({ from, to });
      added = added.filter((name) => name !== to);
      removed = removed.filter((name) => name !== from);
    }
  }

  const sharedNow = current.columns.filter((c) => before.has(c.name)).map((c) => c.name);
  const sharedBefore = earlier.columns.filter((c) => now.has(c.name)).map((c) => c.name);
  const reordered = sharedNow.some((name, i) => name !== sharedBefore[i]);

  const rows = { earlier: earlier.profiledRows, current: current.profiledRows };
  const valuesByColumn = new Map(values.map((v) => [v.column, v]));
  const columns: ColumnComparison[] = current.columns
    .flatMap((column) => {
      const old = before.get(column.name);
      if (!old) return [];
      const changes = compareColumn(column, old, rows, valuesByColumn.get(column.name), region);
      return changes.length > 0 ? [{ name: column.name, changes }] : [];
    })
    .sort((a, b) => SEVERITY_ORDER[a.changes[0].severity] - SEVERITY_ORDER[b.changes[0].severity]);

  const findingsNow = findingKeys(current);
  const findingsBefore = findingKeys(earlier);
  const bySeverity = (a: FindingChange, b: FindingChange) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  const fresh = [...findingsNow]
    .filter(([key]) => !findingsBefore.has(key))
    .map(([, f]) => f)
    .sort(bySeverity);
  const resolved = [...findingsBefore]
    .filter(([key]) => !findingsNow.has(key))
    .map(([, f]) => f)
    .sort(bySeverity);

  const parts: string[] = [];
  const rowChange = rows.current - rows.earlier;
  parts.push(
    rowChange === 0
      ? `The same number of rows (${n(rows.current)})`
      : `${n(Math.abs(rowChange))} ${rowChange > 0 ? 'more' : 'fewer'} rows (${n(rows.earlier)} → ${n(rows.current)})`,
  );
  const structure = added.length + removed.length + renamed.length;
  parts.push(structure === 0 ? 'the same columns' : `${structure} column ${structure === 1 ? 'change' : 'changes'}`);
  parts.push(
    columns.length === 0
      ? 'no notable changes inside the columns'
      : `changes inside ${columns.length} ${columns.length === 1 ? 'column' : 'columns'}`,
  );

  return {
    rows,
    added,
    removed,
    renamed,
    reordered,
    columns,
    findings: { fresh, resolved },
    headline: `${parts[0]}, ${parts[1]}, ${parts[2]}.`,
  };
}

/** Whether the drop in rows is large enough to warn about. */
export function rowsDroppedSeriously(rows: { earlier: number; current: number }): boolean {
  return rows.earlier > 0 && (rows.earlier - rows.current) / rows.earlier >= ROWS_SERIOUS_DROP;
}
