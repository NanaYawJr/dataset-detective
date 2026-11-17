import { allFindings } from '../display';
import type { Comparison } from '../compare/types';
import type { ProfileResult } from '../profile/types';

/**
 * The summary of a report that may be sent for a plain-English
 * explanation. It holds the shape of the data, never the data: column
 * names, types, counts and the titles of findings. No rows, no top values,
 * no examples, no statistics that would reveal a value.
 *
 * Finding titles are written by this app from column names and counts.
 * Comparison notes use their value-free form. As a second guard, anything
 * in quotation marks is masked before it is sent.
 */

export interface ReportSummary {
  file: { format: string; rows: number; columns: number; sampled: boolean; grain?: string };
  columns: {
    name: string;
    type: string;
    role: string;
    missing_share: number;
    distinct: number;
    date_order?: string;
  }[];
  findings: { subject: string; severity: string; title: string; rows?: number }[];
  comparison?: { headline: string; changes: string[] };
}

const MAX_COLUMNS = 400;
const MAX_FINDINGS = 120;
const MAX_CHANGES = 60;

/** Values quoted in app-written text ("On hold", “Mail”) become [value]. */
export function maskQuoted(text: string): string {
  return text.replace(/"[^"]*"|“[^”]*”|‘[^’]*’/g, '[value]');
}

const clip = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);
const round = (share: number) => Math.round(share * 1000) / 1000;

export function buildSummary(result: ProfileResult, comparison?: Comparison | null): ReportSummary {
  const rows = result.profiledRows;
  const summary: ReportSummary = {
    file: {
      format: result.source.kind,
      rows: result.totalRows,
      columns: result.columns.length,
      sampled: result.profiledRows < result.totalRows,
      ...(result.table?.grain ? { grain: clip(result.table.grain, 200) } : {}),
    },
    columns: result.columns.slice(0, MAX_COLUMNS).map((column) => ({
      name: clip(column.name, 120),
      type: column.decision.type,
      role: column.decision.role,
      missing_share: rows > 0 ? round(Math.min(1, column.decision.effectivelyMissing / rows)) : 0,
      distinct: column.facts.distinct,
      ...(column.decision.type === 'date' ? { date_order: column.decision.date?.order ?? 'unknown' } : {}),
    })),
    findings: allFindings(result.columns, result.table)
      .slice(0, MAX_FINDINGS)
      .map((finding) => ({
        subject: clip(finding.subject, 250),
        severity: finding.severity,
        title: clip(maskQuoted(finding.title), 250),
        ...(finding.rows !== undefined ? { rows: finding.rows } : {}),
      })),
  };
  if (comparison) {
    summary.comparison = {
      headline: clip(comparison.headline, 300),
      changes: [
        ...comparison.added.map((name) => `New column: ${name}`),
        ...comparison.removed.map((name) => `Column gone: ${name}`),
        ...comparison.renamed.map(({ from, to }) => `Renamed: ${from} is now ${to}`),
        // The value-free form of each change: no averages, maximums, dates or category values.
        ...comparison.columns.flatMap((column) =>
          column.changes.map((change) => `${column.name}: ${maskQuoted(change.gist)}`),
        ),
      ]
        .slice(0, MAX_CHANGES)
        .map((change) => clip(change, 300)),
    };
  }
  return summary;
}
