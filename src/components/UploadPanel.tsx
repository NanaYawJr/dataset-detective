import { useState, type DragEvent } from 'react';
import type { Scope } from '../lib/profile/types';
import { SAMPLE_ROWS } from '../lib/profile/sql';
import { formatNumber, type Region } from '../lib/region';

interface UploadPanelProps {
  region: Region;
  scope: Scope;
  onScopeChange: (scope: Scope) => void;
  onFile: (file: File) => void;
}

const ACCEPT = '.csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain';

export function UploadPanel({ region, scope, onScopeChange, onFile }: UploadPanelProps) {
  const [dragging, setDragging] = useState(false);

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) onFile(file);
  };

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-12 sm:px-6 sm:py-16">
      <section className="flex max-w-3xl flex-col gap-4">
        <h1 className="text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
          Find what's wrong with a file before anyone builds on it.
        </h1>
        <p className="text-lg leading-relaxed text-ink-soft">
          Drop in a delimited text file to see how it's written, whether it reads cleanly, and what each column really
          contains.
        </p>
      </section>

      <section className="flex flex-wrap items-stretch gap-6">
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-5 rounded-2xl border border-line bg-white p-6">
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={`flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors focus-within:outline-3 focus-within:outline-teal ${
              dragging ? 'border-teal bg-teal-tint' : 'border-[#9db8b1] bg-teal-wash'
            }`}
          >
            <svg
              width="44"
              height="44"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-teal"
              aria-hidden="true"
            >
              <path d="M12 15V3" />
              <path d="m7 8 5-5 5 5" />
              <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
            </svg>
            <span className="text-xl font-bold">Drop a file here, or click to choose</span>
            <span className="text-sm text-muted">
              CSV, TSV or other delimited text · Excel, Parquet and JSON coming soon
            </span>
            <input
              type="file"
              accept={ACCEPT}
              className="sr-only"
              data-testid="file-input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onFile(file);
                e.target.value = '';
              }}
            />
          </label>

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-3 text-sm font-bold">How much should be profiled?</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ScopeOption
                checked={scope === 'full'}
                onSelect={() => onScopeChange('full')}
                title="Full file"
                detail="Every row. Needed for exact duplicate and key checks."
              />
              <ScopeOption
                checked={scope === 'sample'}
                onSelect={() => onScopeChange('sample')}
                title="Quick sample"
                detail={`${formatNumber(SAMPLE_ROWS, region)} random rows, the same ones every time. Faster on big files.`}
              />
            </div>
          </fieldset>
        </div>

        <aside className="flex min-w-0 flex-[1_1_300px] flex-col gap-3 rounded-2xl bg-ink p-6 text-paper">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-teal-light"
            aria-hidden="true"
          >
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          <h2 className="text-lg font-bold">Your data never leaves this device</h2>
          <p className="text-sm leading-relaxed text-[#c7d2cd]">
            Files are read and profiled inside your browser. The page's security policy blocks it from sending data
            anywhere, and the analysis engine is served with the page rather than downloaded from elsewhere.
          </p>
        </aside>
      </section>
    </main>
  );
}

interface ScopeOptionProps {
  checked: boolean;
  onSelect: () => void;
  title: string;
  detail: string;
}

function ScopeOption({ checked, onSelect, title, detail }: ScopeOptionProps) {
  return (
    <label
      className={`flex cursor-pointer gap-3 rounded-xl p-4 ${
        checked ? 'border-2 border-teal bg-teal-tint' : 'border border-line-strong bg-white'
      }`}
    >
      <input type="radio" name="scope" checked={checked} onChange={onSelect} className="mt-1 size-4 accent-teal" />
      <span className="flex flex-col gap-1">
        <span className="font-bold">{title}</span>
        <span className="text-sm text-ink-soft">{detail}</span>
      </span>
    </label>
  );
}
