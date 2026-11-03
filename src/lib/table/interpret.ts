import type { Region } from '../region';
import type { CoverageResult, MonthCount, TableFinding, TableReport, TableResults } from './types';

/** Turns the raw answers from the table queries into findings. Pure, so it is tested directly. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const NEAR = 0.05;
const MAX_DEPENDENCY_NOTES = 5;
const MIN_ROWS_PER_MONTH = 5;

const n = (value: number) => value.toLocaleString('en-GB');
const rowsWord = (count: number) => (count === 1 ? '1 row' : `${n(count)} rows`);
const pct = (share: number) => `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;

export function formatMonth(month: number, region: Region): string {
  const year = Math.floor(month / 100);
  const m = month % 100;
  return region === 'CA' ? `${year}-${String(m).padStart(2, '0')}` : `${MONTHS[m - 1]} ${year}`;
}

function nextMonth(month: number): number {
  const year = Math.floor(month / 100);
  const m = month % 100;
  return m === 12 ? (year + 1) * 100 + 1 : month + 1;
}

/** Calendar months between the first and last month with rows that have none. */
export function missingMonths(months: { month: number; rows: number }[]): number[] {
  if (months.length === 0) return [];
  const present = new Set(months.filter((m) => m.rows > 0).map((m) => m.month));
  const sorted = [...present].sort((a, b) => a - b);
  const missing: number[] = [];
  for (let m = sorted[0]; m < sorted[sorted.length - 1]; m = nextMonth(m)) if (!present.has(m)) missing.push(m);
  return missing;
}

/** Every calendar month from the first to the last with rows, with zero for months that have none. */
export function fillMonths(months: MonthCount[]): MonthCount[] {
  const withRows = months.filter((m) => m.rows > 0);
  if (withRows.length === 0) return [];
  const byMonth = new Map(withRows.map((m) => [m.month, m.rows]));
  const filled: MonthCount[] = [];
  const last = withRows[withRows.length - 1].month;
  for (let m = withRows[0].month; m <= last; m = nextMonth(m)) {
    filled.push({ month: m, rows: byMonth.get(m) ?? 0 });
  }
  return filled;
}

function monthSpan(first: number, last: number): number {
  return (Math.floor(last / 100) - Math.floor(first / 100)) * 12 + ((last % 100) - (first % 100)) + 1;
}

function listOf(items: string[], max = 3): string {
  const shown = items.slice(0, max);
  const more = items.length - shown.length;
  const joined = shown.length <= 1 ? shown.join('') : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
  return more > 0 ? `${shown.join(', ')} and ${n(more)} more` : joined;
}

function coverageFindings(coverage: CoverageResult[], region: Region): TableFinding[] {
  const found: TableFinding[] = [];
  for (const { column, months, future } of coverage) {
    const withRows = months.filter((m) => m.rows > 0);
    if (withRows.length > 0) {
      const span = monthSpan(withRows[0].month, withRows[withRows.length - 1].month);
      const total = withRows.reduce((sum, m) => sum + m.rows, 0);
      const gaps = missingMonths(months);
      if (span >= 3 && total / span >= MIN_ROWS_PER_MONTH && gaps.length > 0) {
        const labels = gaps.map((m) => formatMonth(m, region));
        found.push({
          kind: 'date-gaps',
          severity: 'warn',
          columns: [column],
          title: gaps.length === 1 ? `No rows in ${labels[0]}` : `${gaps.length} months with no rows`,
          detail: `${column} runs from ${formatMonth(withRows[0].month, region)} to ${formatMonth(withRows[withRows.length - 1].month, region)}, but ${listOf(labels)} ${gaps.length === 1 ? 'has' : 'have'} no rows at all. Check whether part of the extract is missing before reporting on this period.`,
        });
      }
    }
    if (future > 0) {
      found.push({
        kind: 'future-dates',
        severity: 'warn',
        columns: [column],
        title: `${rowsWord(future)} dated in the future`,
        detail: `These dates are after today, which usually means a typing error or a placeholder date.`,
        rows: future,
      });
    }
  }
  return found;
}

export function interpretTable(results: TableResults, options: { sampled: boolean; region: Region }): TableReport {
  const findings: TableFinding[] = [];
  const inSample = options.sampled ? ' in the sampled rows' : '';
  let grain: string | null = null;

  if (results.duplicateRows > 0) {
    findings.push({
      kind: 'duplicate-rows',
      severity: results.duplicateRows / results.rows >= 0.01 ? 'high' : 'warn',
      columns: [],
      title: `${rowsWord(results.duplicateRows)} are exact copies of another row`,
      detail: `Every column matches another row${inSample} (${pct(results.duplicateRows / results.rows)} of rows). Counts and totals will be inflated unless the copies are removed.`,
      rows: results.duplicateRows,
    });
  } else if (results.singleKeys.length > 0) {
    grain = `Each row is one ${results.singleKeys[0]}`;
    findings.push({
      kind: 'grain',
      severity: 'info',
      columns: [results.singleKeys[0]],
      title: grain,
      detail: `${results.singleKeys[0]} is filled in and different on every row${inSample}, so it can be used as the key.`,
    });
  } else if (results.pairKey) {
    const [a, b] = results.pairKey;
    grain = `Each row is one combination of ${a} and ${b}`;
    findings.push({
      kind: 'grain',
      severity: 'info',
      columns: [a, b],
      title: grain,
      detail: `No single column identifies a row, but ${a} and ${b} together are different on every row${inSample}.`,
    });
  } else if (results.pairsChecked > 0) {
    findings.push({
      kind: 'no-key',
      severity: 'info',
      columns: [],
      title: 'No column or pair of columns identifies a row',
      detail: `Rows can't be told apart by any single column or by the ${n(results.pairsChecked)} pairs checked${inSample}, so joins and de-duplication need care.`,
    });
  }

  // Dependencies: report broken ones as warnings, and a few exact ones as notes.
  const seenPairs = new Set<string>();
  let notes = 0;
  for (const d of results.dependencies) {
    // A value seen in one row can only ever map to one value, so it proves nothing:
    // judge the dependency by the values that repeat, and only when most do.
    const meaningful =
      d.keys >= 3 && d.repeated >= 3 && d.repeated >= d.keys / 2 && d.toDistinct >= 2 && d.toDistinct < d.keys;
    if (!meaningful) continue;
    const pairKey = [d.from, d.to].sort().join('|');
    if (d.violating === 0 && !seenPairs.has(pairKey) && notes < MAX_DEPENDENCY_NOTES) {
      seenPairs.add(pairKey);
      notes += 1;
      findings.push({
        kind: 'dependency',
        severity: 'info',
        columns: d.within ? [d.within] : [d.from, d.to],
        title: `Each ${d.from} has exactly one ${d.to}`,
        detail: `${d.within ? `Inside ${d.within}, all` : 'All'} ${n(d.keys)} values of ${d.from} map to a single ${d.to}. A lookup table can hold ${d.to} instead of repeating it on every row.`,
      });
    } else if (d.violating > 0 && d.violating / d.repeated <= NEAR) {
      findings.push({
        kind: 'dependency-broken',
        severity: 'warn',
        columns: d.within ? [d.within] : [d.from, d.to],
        title: `${d.violating === 1 ? '1 value' : `${n(d.violating)} values`} of ${d.from} map to more than one ${d.to}`,
        detail: `${d.within ? `Inside ${d.within}, ` : ''}${pct(1 - d.violating / d.repeated)} of the ${d.from} values that repeat have a single ${d.to}, but ${listOf(d.examples.map((e) => `"${e}"`))} ${d.violating === 1 ? 'has' : 'have'} more than one. These are often typos or codes that changed over time.`,
        rows: d.violating,
      });
    }
  }

  // Order of events between date columns.
  for (const p of results.datePairs) {
    if (p.both < 20) continue;
    const orient = (earlier: string, later: string, inOrder: number, reversed: number) => {
      if (inOrder < p.both / 2) return;
      if (reversed === 0) {
        findings.push({
          kind: 'event-order',
          severity: 'info',
          columns: [earlier, later],
          title: `${later} is never before ${earlier}`,
          detail: `In all ${n(p.both)} rows with both dates, ${later} is on or after ${earlier}.`,
        });
      } else if (reversed / p.both <= NEAR) {
        findings.push({
          kind: 'event-order-broken',
          severity: 'warn',
          columns: [earlier, later],
          title: `${later} is before ${earlier} in ${rowsWord(reversed)}`,
          detail: `In every other row ${later} is on or after ${earlier}, so these rows are probably entry errors or swapped dates.`,
          rows: reversed,
        });
      }
    };
    orient(p.a, p.b, p.aBeforeB, p.bBeforeA);
    orient(p.b, p.a, p.bBeforeA, p.aBeforeB);
  }

  findings.push(...coverageFindings(results.coverage, options.region));

  return { findings, grain, coverage: results.coverage };
}
