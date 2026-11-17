import { useMemo, type ReactNode } from 'react';
import { BLOCKING_PROBLEMS, DELIMITER_NAMES } from '../lib/format/detectFormat';
import { encodingName, explainProblem, formatBytes } from '../lib/format/explain';
import type { ProfileResult } from '../lib/profile/types';
import { formatDate, formatNumber, localCalendarDate, type Region } from '../lib/region';
import { allFindings } from '../lib/display';
import type { ColumnOverride } from '../lib/rules/types';
import { ColumnTable } from './ColumnTable';
import { CoverageSection } from './CoverageChart';
import { FindingsPanel } from './FindingsPanel';
import { FixPanel } from './FixPanel';
import { ComparePanel } from './ComparePanel';
import { ExplainPanel } from './ExplainPanel';
import { compareProfiles } from '../lib/compare/compare';
import type { ComparisonState } from '../hooks/useComparison';

interface ResultsViewProps {
  result: ProfileResult;
  region: Region;
  /** True while a correction or region change is being applied. */
  updating: boolean;
  onOverride: (column: string, override: ColumnOverride | null) => void;
  /** Profiles another sheet of the same workbook. */
  onSheet: (sheet: number) => void;
  comparison: ComparisonState;
  onCompare: (file: File) => void;
  onClearComparison: () => void;
  onFeedback: () => void;
  onChooseAnother: () => void;
}

export function ResultsView({
  result,
  region,
  updating,
  onOverride,
  onSheet,
  comparison,
  onCompare,
  onClearComparison,
  onFeedback,
  onChooseAnother,
}: ResultsViewProps) {
  const { format, source } = result;
  const columnNames: Record<typeof source.kind, string> = {
    delimited: 'Names from the header row',
    excel: 'Names from the header row',
    parquet: "Names from the file's schema",
    json: 'Names from the record keys',
  };
  const sampled = result.scope === 'sample' && result.profiledRows < result.totalRows;
  const notes = format.problems.filter((p) => !BLOCKING_PROBLEMS.includes(p.kind));
  const findings = allFindings(result.columns, result.table);
  const grain = result.table?.grain;
  const comparisonResult = useMemo(
    () =>
      comparison.status === 'done'
        ? compareProfiles(result, comparison.earlier, comparison.tables.values, region)
        : null,
    [comparison, result, region],
  );

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-mono text-sm text-muted">
            Profiled {formatDate(localCalendarDate(result.profiledAt), region)} ·{' '}
            {formatNumber(result.durationMs / 1000, region, 1)}s
          </p>
          <h1 className="break-words text-3xl font-extrabold tracking-tight">{result.fileName}</h1>
          {source.kind !== 'delimited' && (
            <p className="break-words text-sm text-ink-soft" data-testid="source-line">
              {[source.label, ...source.facts].join(' · ')}
            </p>
          )}
          {grain && (
            <p className="text-ink-soft" data-testid="grain">
              {grain}.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {source.sheets && source.sheets.length > 1 && (
            <label className="flex flex-col gap-1 text-sm font-semibold text-muted">
              Sheet
              <select
                className="min-h-11 max-w-60 rounded-xl border border-line-strong bg-white px-3 font-bold text-ink"
                value={source.sheetIndex}
                onChange={(e) => onSheet(Number(e.target.value))}
              >
                {source.sheets.map((sheet, i) => (
                  <option key={sheet.name} value={i}>
                    {sheet.name}
                    {sheet.hidden ? ' (hidden)' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            onClick={onChooseAnother}
            className="min-h-11 rounded-xl border border-line-strong bg-white px-5 font-bold text-ink hover:bg-surface"
          >
            Profile another file
          </button>
        </div>
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
          {format.hasHeader ? columnNames[source.kind] : 'No header row found'}
        </Stat>
        {source.kind === 'delimited' ? (
          <>
            <Stat label="Delimiter" value={DELIMITER_NAMES[format.delimiter]}>
              {format.lineEnding === 'none' ? 'Single line' : `${format.lineEnding} line endings`}
            </Stat>
            <Stat label="Encoding" value={encodingName(format.encoding)}>
              {formatBytes(result.fileSize)}
            </Stat>
          </>
        ) : (
          source.cards.map((card, i) => (
            <Stat key={card.label} label={card.label} value={card.value} asWritten>
              {i === source.cards.length - 1 ? `${card.hint} · ${formatBytes(result.fileSize)}` : card.hint}
            </Stat>
          ))
        )}
      </section>

      {(notes.length > 0 || source.notes.length > 0 || result.skippedRows > 0 || sampled) && (
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
            {source.notes.map((note) => (
              <li key={note.key} data-testid={`note-${note.key}`}>
                <strong>{note.title}.</strong> {note.detail}
              </li>
            ))}
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

      <p className="sr-only" aria-live="polite">
        {updating ? 'Updating the findings…' : ''}
      </p>
      {updating && (
        <p
          className="sticky top-2 z-10 self-center rounded-full bg-ink px-4 py-2 text-sm font-bold text-white shadow"
          data-testid="updating"
        >
          Updating the findings…
        </p>
      )}

      <FindingsPanel findings={findings} />

      <ExplainPanel result={result} comparison={comparisonResult} />

      <FixPanel result={result} />

      <ComparePanel
        result={result}
        region={region}
        state={comparison}
        onCompare={onCompare}
        onClear={onClearComparison}
      />

      {result.table && <CoverageSection coverage={result.table.coverage} region={region} />}

      <ColumnTable
        columns={result.columns}
        rows={result.profiledRows}
        region={region}
        overrides={result.overrides}
        onOverride={onOverride}
      />

      <aside
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white px-5 py-4"
        aria-label="Feedback"
      >
        <p className="text-sm text-ink-soft">
          <strong className="text-ink">Was this useful?</strong> Tell me in 30 seconds what worked and what didn't.
        </p>
        <button
          type="button"
          onClick={onFeedback}
          className="min-h-11 rounded-xl border border-line-strong bg-white px-5 text-sm font-bold text-ink hover:bg-surface"
        >
          Give feedback
        </button>
      </aside>
    </main>
  );
}

interface StatProps {
  label: string;
  value: string;
  /** Keep the value's own capitalisation (a sheet name, for example). */
  asWritten?: boolean;
  children: ReactNode;
}

function Stat({ label, value, asWritten, children }: StatProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-2xl border border-line bg-white px-5 py-4">
      <span className="text-sm font-semibold text-muted">{label}</span>
      <span
        className={`break-words text-2xl font-extrabold ${asWritten ? '' : 'capitalize'}`}
        data-testid={`stat-${label.toLowerCase().replaceAll(' ', '-')}`}
      >
        {value}
      </span>
      <span className="text-sm text-ink-soft">{children}</span>
    </div>
  );
}
