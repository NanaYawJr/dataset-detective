import { BLOCKING_PROBLEMS, type FormatReport } from '../lib/format/detectFormat';
import { describeFormat, explainProblem, formatBytes } from '../lib/format/explain';

interface StopPanelProps {
  file: File;
  format?: FormatReport;
  /** Set when the in-browser database failed rather than the format check. */
  engineMessage?: string;
  onSkipBrokenRows?: () => void;
  onChooseAnother: () => void;
}

export function StopPanel({ file, format, engineMessage, onSkipBrokenRows, onChooseAnother }: StopPanelProps) {
  const blocking = format?.problems.filter((p) => BLOCKING_PROBLEMS.includes(p.kind)) ?? [];
  const canSkip =
    Boolean(onSkipBrokenRows) &&
    (engineMessage !== undefined || blocking.every((p) => p.kind === 'inconsistent-fields'));

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-16 sm:px-6">
      <div className="flex flex-col gap-1">
        <p className="font-mono text-sm text-muted">
          {file.name} · {formatBytes(file.size)}
          {format && format.problems[0]?.kind !== 'not-text' && format.problems[0]?.kind !== 'empty-file'
            ? ` · ${describeFormat(format)}`
            : ''}
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight">This file can't be read cleanly yet</h1>
      </div>

      <div role="alert" className="flex flex-col gap-4 rounded-2xl border border-[#e9b8b2] bg-red-tint p-6">
        {blocking.map((problem) => {
          const { title, detail } = explainProblem(problem);
          return (
            <div key={problem.kind} className="flex flex-col gap-1">
              <h2 className="text-lg font-bold text-red">{title}</h2>
              <p className="leading-relaxed text-[#5e1a13]">{detail}</p>
            </div>
          );
        })}
        {engineMessage && (
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-bold text-red">The file stopped loading part-way through</h2>
            <p className="leading-relaxed text-[#5e1a13]">
              The start of the file looked fine, but a problem further down stopped it loading. The reader reported:
            </p>
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-white/70 p-3 font-mono text-sm text-[#5e1a13]">
              {engineMessage}
            </pre>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        {canSkip && onSkipBrokenRows && (
          <button
            type="button"
            onClick={onSkipBrokenRows}
            className="min-h-11 rounded-xl bg-teal px-5 font-bold text-white hover:bg-teal-dark"
          >
            Skip broken rows and continue
          </button>
        )}
        <button
          type="button"
          onClick={onChooseAnother}
          className="min-h-11 rounded-xl border border-line-strong bg-white px-5 font-bold text-ink hover:bg-surface"
        >
          Choose another file
        </button>
      </div>
      {canSkip && (
        <p className="text-sm text-muted">
          Skipped rows are counted and shown in the report, so nothing disappears silently.
        </p>
      )}
    </main>
  );
}
