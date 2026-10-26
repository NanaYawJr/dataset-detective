import type { Finding, Severity } from '../lib/rules/types';

export type RankedFinding = Finding & { column: string };

const BADGE: Record<Severity, { label: string; className: string }> = {
  high: { label: 'High', className: 'bg-red text-white' },
  warn: { label: 'Warning', className: 'bg-amber-tint text-amber' },
  info: { label: 'Note', className: 'bg-surface text-ink-soft' },
};

export function FindingsPanel({ findings }: { findings: RankedFinding[] }) {
  const counts = { high: 0, warn: 0, info: 0 };
  for (const f of findings) counts[f.severity] += 1;
  const important = findings.filter((f) => f.severity !== 'info');
  const notes = findings.filter((f) => f.severity === 'info');

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-white" aria-labelledby="findings-heading">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <h2 id="findings-heading" className="text-lg font-extrabold">
          Findings
        </h2>
        <p className="flex flex-wrap gap-2 text-xs font-bold" data-testid="finding-counts">
          <span className="rounded-full bg-red-tint px-2.5 py-1 text-red">{counts.high} high</span>
          <span className="rounded-full bg-amber-tint px-2.5 py-1 text-amber">
            {counts.warn} {counts.warn === 1 ? 'warning' : 'warnings'}
          </span>
          <span className="rounded-full bg-surface px-2.5 py-1 text-ink-soft">
            {counts.info} {counts.info === 1 ? 'note' : 'notes'}
          </span>
        </p>
      </div>

      {findings.length === 0 && <p className="px-5 py-4 text-ink-soft">No problems found in this file.</p>}

      <ul>
        {important.map((f) => (
          <FindingRow key={`${f.column}-${f.kind}`} finding={f} />
        ))}
      </ul>

      {notes.length > 0 && (
        <details className="border-t border-line">
          <summary className="flex min-h-11 cursor-pointer items-center px-5 text-sm font-bold text-teal-dark">
            Show {notes.length} {notes.length === 1 ? 'note' : 'notes'}
          </summary>
          <ul>
            {notes.map((f) => (
              <FindingRow key={`${f.column}-${f.kind}`} finding={f} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function FindingRow({ finding }: { finding: RankedFinding }) {
  const badge = BADGE[finding.severity];
  return (
    <li className="flex gap-4 border-t border-line px-5 py-4 first:border-t-0">
      <span className={`mt-0.5 h-fit shrink-0 rounded-md px-2 py-0.5 text-xs font-extrabold ${badge.className}`}>
        {badge.label}
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-bold">
          <span className="font-mono text-sm font-semibold text-ink-soft">{finding.column}</span>
          <span className="mx-2 text-muted" aria-hidden="true">
            ·
          </span>
          {finding.title}
        </p>
        <p className="text-sm leading-relaxed text-ink-soft">{finding.detail}</p>
      </div>
    </li>
  );
}
