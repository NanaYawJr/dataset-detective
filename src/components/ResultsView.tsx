import type { ReactNode } from 'react';
import { BLOCKING_PROBLEMS, DELIMITER_NAMES } from '../lib/format/detectFormat';
import { encodingName, explainProblem, formatBytes } from '../lib/format/explain';
import type { ProfileResult } from '../lib/profile/types';
import { formatDate, formatNumber, localCalendarDate, type Region } from '../lib/region';
import { ColumnTable } from './ColumnTable';

interface ResultsViewProps {
  result: ProfileResult;
  region: Region;
  onChooseAnother: () => void;
}

export function ResultsView({ result, region, onChooseAnother }: ResultsViewProps) {
  const { format } = result;
  const sampled = result.scope === 'sample' && result.profiledRows < result.totalRows;
  const notes = format.problems.filter((p) => !BLOCKING_PROBLEMS.includes(p.kind));

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-mono text-sm text-muted">
            Profiled {formatDate(localCalendarDate(result.profiledAt), region)} ·{' '}
            {formatNumber(result.durationMs / 1000, region, 1)}s
          </p>
        </div>
        <button
          type="button"
          onClick={onChooseAnother}
          className="min-h-11 rounded-xl border border-line-strong bg-white px-5 font-bold text-ink hover:bg-surface"
        >
          Profile another file
        </button>
      </div>

      <section className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3" aria-label="File summary">
        <Stat label="Rows" value={formatNumber(result.totalRows, region)}>
          {sampled
            ? `${formatNumber(result.profiledRows, region)} sampled`
            : result.skippedRows > 0
              ? `${formatNumber(result.skippedRows, region)} broken rows skipped`
              : 'All rows profiled'}
        </Stat>
        <Stat label="Columns" value={formatNumber(result.columns.length, region)}>
          {format.hasHeader ? 'Names from the header row' : 'No header row found'}
        </Stat>
        <Stat label="Delimiter" value={DELIMITER_NAMES[format.delimiter]}>
          {format.lineEnding === 'none' ? 'Single line' : `${format.lineEnding} line endings`}
        </Stat>
        <Stat label="Encoding" value={encodingName(format.encoding)}>
          {formatBytes(result.fileSize)}
        </Stat>
      </section>

      {(notes.length > 0 || result.skippedRows > 0 || sampled) && (
        <section className="flex flex-col gap-3 rounded-2xl border border-[#e8c99a] bg-amber-tint p-5">
          <h2 className="font-extrabold text-amber">Worth knowing</h2>
          <ul className="flex flex-col gap-2 text-sm text-[#5e3407]">
            {result.skippedRows > 0 && (
              <li>
                <strong>{formatNumber(result.skippedRows, region)} broken rows were skipped</strong> because they had
                the wrong number of columns. Every figure below excludes them.
              </li>
            )}
            {sampled && (
              <li>
                <strong>These figures come from a sample</strong> of {formatNumber(result.profiledRows, region)} rows
                out of {formatNumber(result.totalRows, region)}. Profile the full file for exact counts.
              </li>
            )}
            {notes.map((problem) => {
              const { title, detail } = explainProblem(problem);
              return (
                <li key={problem.kind}>
                  <strong>{title}.</strong> {detail}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <ColumnTable columns={result.columns} rows={result.profiledRows} region={region} />
    </main>
  );
}

function Stat({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-line bg-white px-5 py-4">
      <span className="text-sm font-semibold text-muted">{label}</span>
      <span className="text-2xl font-extrabold capitalize" data-testid={`stat-${label.toLowerCase()}`}>
        {value}
      </span>
      <span className="text-sm text-ink-soft">{children}</span>
    </div>
  );
}
