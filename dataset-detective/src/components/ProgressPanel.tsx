import { STEPS, STEP_LABELS, type Step } from '../lib/profile/types';
import { formatBytes } from '../lib/format/explain';

interface ProgressPanelProps {
  file: File;
  step: Step;
}

export function ProgressPanel({ file, step }: ProgressPanelProps) {
  const current = STEPS.indexOf(step);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-16 sm:px-6">
      <div className="flex flex-col gap-1">
        <p className="font-mono text-sm text-muted">
          {file.name} · {formatBytes(file.size)}
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight">Profiling your file…</h1>
      </div>

      <ol className="flex flex-col gap-2 rounded-2xl border border-line bg-white p-6" aria-live="polite">
        {STEPS.map((s, index) => {
          const state = index < current ? 'done' : index === current ? 'current' : 'pending';
          return (
            <li key={s} className="flex items-center gap-3 py-1.5 text-base">
              <StepIcon state={state} />
              <span
                className={state === 'pending' ? 'text-muted' : state === 'current' ? 'font-bold' : 'text-ink-soft'}
              >
                {STEP_LABELS[s]}
                {state === 'current' && <span className="sr-only"> (in progress)</span>}
                {state === 'done' && <span className="sr-only"> (done)</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </main>
  );
}

function StepIcon({ state }: { state: 'done' | 'current' | 'pending' }) {
  if (state === 'done') {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="#0f6b5c" />
        <path d="m7.5 12.5 3 3 6-7" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (state === 'current') {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="animate-spin" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="#dde2dc" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="#0f6b5c" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="#c9d1cb" strokeWidth="2" />
    </svg>
  );
}
