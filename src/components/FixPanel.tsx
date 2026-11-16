import { useMemo, useState, type ReactNode } from 'react';
import { fixPlanFor } from '../lib/fix/fromProfile';
import { toPandas } from '../lib/fix/pandas';
import { slug } from '../lib/fix/plan';
import { toPowerQuery } from '../lib/fix/powerQuery';
import { toTsql } from '../lib/fix/tsql';
import type { ProfileResult } from '../lib/profile/types';

type Language = 'power-query' | 't-sql' | 'pandas';

const LANGUAGES: { id: Language; label: string; extension: string; where: string }[] = [
  {
    id: 'power-query',
    label: 'Power Query',
    extension: 'pq',
    where: 'In Power BI or Excel: Get Data, Blank Query, Advanced Editor, then paste.',
  },
  {
    id: 't-sql',
    label: 'T-SQL',
    extension: 'sql',
    where: 'For SQL Server: load the file into a staging table as text first, as the script explains.',
  },
  { id: 'pandas', label: 'pandas', extension: 'py', where: 'For Python: save it beside the file and run it.' },
];

/**
 * Shows column names inside a sentence in the monospace font, where a pipe
 * in a name such as "City | Region" can't be mistaken for a letter.
 */
function withNames(line: string, names: string[]): ReactNode[] {
  const known = names.filter(Boolean).sort((a, b) => b.length - a.length);
  if (known.length === 0) return [line];
  const escaped = known.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // Only whole names: a column called "id" must not light up inside "provided".
  const pattern = new RegExp(`(?<![A-Za-z0-9])(${escaped.join('|')})(?![A-Za-z0-9])`);
  return line.split(pattern).map((part, i) =>
    known.includes(part) ? (
      <span key={i} className="font-mono text-[0.95em] font-semibold">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/** A script that fixes what the profile found, in the user's choice of language. */
export function FixPanel({ result }: { result: ProfileResult }) {
  const [language, setLanguage] = useState<Language>('power-query');
  const [copied, setCopied] = useState(false);

  const plan = useMemo(() => fixPlanFor(result), [result]);
  const code = useMemo(() => {
    if (language === 'power-query') return toPowerQuery(plan);
    return language === 't-sql' ? toTsql(plan) : toPandas(plan);
  }, [plan, language]);
  const current = LANGUAGES.find((l) => l.id === language)!;
  const names = useMemo(
    () => [
      ...result.columns.map((c) => c.name),
      ...plan.columns.flatMap((c) => c.steps.flatMap((s) => (s.kind === 'rank' ? [s.newColumn] : []))),
    ],
    [result.columns, plan],
  );
  const fileName = `clean_${slug(result.fileName)}.${current.extension}`;

  const choose = (next: Language) => {
    setLanguage(next);
    setCopied(false);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-white" aria-labelledby="fix-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-4">
        <h2 id="fix-heading" className="text-lg font-extrabold">
          Fix it
        </h2>
        <p className="text-sm text-muted">A script that cleans this file, written from what the profile found.</p>
      </div>

      <div className="flex flex-col gap-4 px-5 py-5">
        <div>
          <h3 className="text-sm font-bold">What the script does</h3>
          <ol
            className="mt-2 flex list-decimal flex-col gap-1 pl-5 text-sm leading-relaxed text-ink-soft"
            data-testid="fix-summary"
          >
            {plan.summary.map((line) => (
              <li key={line}>{withNames(line, names)}</li>
            ))}
          </ol>
        </div>

        {plan.leftAlone.length > 0 && (
          <div>
            <h3 className="text-sm font-bold">What it leaves alone</h3>
            <ul
              className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm leading-relaxed text-ink-soft"
              data-testid="fix-left-alone"
            >
              {plan.leftAlone.map((line) => (
                <li key={line}>{withNames(line, names)}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="Language" className="flex gap-1 rounded-xl bg-surface p-1">
            {LANGUAGES.map((l) => (
              <button
                key={l.id}
                type="button"
                role="tab"
                id={`fix-tab-${l.id}`}
                aria-selected={language === l.id}
                aria-controls="fix-code"
                onClick={() => choose(l.id)}
                className={`min-h-11 rounded-lg px-4 text-sm font-bold ${
                  language === l.id ? 'bg-white text-ink shadow-sm' : 'text-ink-soft hover:text-ink'
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void copy()}
              className="min-h-11 rounded-xl border border-line-strong bg-white px-4 text-sm font-bold text-ink hover:bg-surface"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={download}
              className="min-h-11 rounded-xl bg-teal px-4 text-sm font-bold text-white hover:bg-teal-dark"
            >
              Download {fileName}
            </button>
          </div>
        </div>

        <p className="text-sm text-muted">
          {current.where} Read the script before you run it: it changes a copy of the data, never the file.
        </p>

        <pre
          id="fix-code"
          role="tabpanel"
          aria-labelledby={`fix-tab-${language}`}
          tabIndex={0}
          className="max-h-[28rem] overflow-auto rounded-xl bg-ink p-4 font-mono text-xs leading-relaxed text-[#e6efe9]"
          data-testid="fix-code"
        >
          <code>{code}</code>
        </pre>
      </div>
    </section>
  );
}
