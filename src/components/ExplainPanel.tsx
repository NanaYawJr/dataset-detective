import { useEffect, useMemo, useState } from 'react';
import type { Comparison } from '../lib/compare/types';
import {
  fetchExplainStatus,
  PROVIDER_NAMES,
  requestExplanation,
  toBlocks,
  type ExplainStatus,
  type Provider,
} from '../lib/explain/client';
import { buildSummary } from '../lib/explain/summary';
import type { ProfileResult } from '../lib/profile/types';

interface Written {
  /** The summary the text was written from, to notice when the report has changed since. */
  summary: string;
  text: string;
  provider: Provider;
}

/** An optional plain-English explanation of the report, written by a language model from a summary. */
export function ExplainPanel({ result, comparison }: { result: ProfileResult; comparison: Comparison | null }) {
  const [status, setStatus] = useState<ExplainStatus | null | 'loading'>('loading');
  const [useOwnKey, setUseOwnKey] = useState(false);
  const [provider, setProvider] = useState<Provider>('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [written, setWritten] = useState<Written | null>(null);

  const summary = useMemo(() => buildSummary(result, comparison), [result, comparison]);
  const summaryJson = useMemo(() => JSON.stringify(summary, null, 2), [summary]);

  useEffect(() => {
    let current = true;
    void fetchExplainStatus().then((next) => {
      if (current) setStatus(next);
    });
    return () => {
      current = false;
    };
  }, []);

  if (status === 'loading' || (status && !status.enabled)) return null;

  const free = status?.available ? status.remaining : 0;
  const ownKeyAllowed = status?.own_key ?? false;
  const mode: 'free' | 'own' = useOwnKey || free === 0 ? 'own' : 'free';
  const canSend = !busy && status !== null && (mode === 'free' ? free > 0 : ownKeyAllowed && apiKey.trim() !== '');

  const explain = async () => {
    setBusy(true);
    setError('');
    const sent = summaryJson;
    const answer = await requestExplanation(summary, mode === 'own' ? { provider, apiKey: apiKey.trim() } : undefined);
    setBusy(false);
    if (answer.ok) {
      setWritten({ summary: sent, text: answer.text, provider: answer.provider });
      if (mode === 'free') void fetchExplainStatus().then((next) => next && setStatus(next));
    } else {
      setError(answer.message);
    }
  };

  const stale = written !== null && written.summary !== summaryJson;

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-white" aria-labelledby="explain-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-4">
        <h2 id="explain-heading" className="text-lg font-extrabold">
          Explain in plain English
        </h2>
        <p className="text-sm text-muted">Optional. Written by AI from a summary of this report.</p>
      </div>

      <div className="flex flex-col gap-4 px-5 py-5">
        {status === null ? (
          <p className="text-sm text-ink-soft" role="status">
            The explanation service can't be reached at the moment.
          </p>
        ) : (
          <>
            <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
              Sends a summary of this report to the site's server, which asks an AI model to explain it. The summary
              holds column names, types, counts and the titles of findings: <strong>no rows and no values</strong>.
            </p>

            <details className="text-sm">
              <summary className="flex min-h-11 w-fit cursor-pointer items-center font-bold text-teal-dark">
                See exactly what will be sent
              </summary>
              <pre
                className="mt-1 max-h-72 overflow-auto rounded-xl bg-surface p-4 font-mono text-xs leading-relaxed text-ink"
                data-testid="explain-payload"
              >
                {summaryJson}
              </pre>
            </details>

            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">Whose key to use</legend>
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="radio"
                  name="explain-mode"
                  checked={mode === 'free'}
                  disabled={free === 0}
                  onChange={() => setUseOwnKey(false)}
                  className="size-4 accent-teal"
                />
                <span className={free === 0 ? 'text-muted' : ''}>
                  {free > 0 ? `Use a free explanation (${free} left today)` : 'No free explanations left today'}
                </span>
              </label>
              {ownKeyAllowed && (
                <label className="flex min-h-11 items-center gap-3 text-sm">
                  <input
                    type="radio"
                    name="explain-mode"
                    checked={mode === 'own'}
                    onChange={() => setUseOwnKey(true)}
                    className="size-4 accent-teal"
                  />
                  Use my own API key
                </label>
              )}
            </fieldset>

            {mode === 'own' && ownKeyAllowed && (
              <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
                <div className="flex flex-wrap gap-3">
                  <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                    Provider
                    <select
                      value={provider}
                      onChange={(e) => setProvider(e.target.value as Provider)}
                      className="min-h-11 rounded-lg border border-line-strong bg-white px-2 text-sm font-semibold text-ink"
                    >
                      <option value="anthropic">Claude (Anthropic)</option>
                      <option value="openai">OpenAI</option>
                    </select>
                  </label>
                  <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-semibold text-muted">
                    API key
                    <input
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder={provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
                      className="min-h-11 w-full min-w-48 rounded-lg border border-line-strong bg-white px-3 font-mono text-sm text-ink"
                    />
                  </label>
                </div>
                <p className="text-xs leading-relaxed text-muted">
                  Your key goes to this site's server for this one request, is passed to {PROVIDER_NAMES[provider]}, and
                  is never stored or logged. It is kept in this page only until you close or reload it. You pay{' '}
                  {PROVIDER_NAMES[provider]} for the request.
                </p>
              </div>
            )}

            <div>
              <button
                type="button"
                onClick={() => void explain()}
                disabled={!canSend}
                className="min-h-11 rounded-xl bg-teal px-5 text-sm font-bold text-white hover:bg-teal-dark disabled:opacity-50"
              >
                {busy ? 'Writing…' : written ? 'Explain again' : 'Explain this report'}
              </button>
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-xl border border-[#e9b8b2] bg-red-tint px-4 py-3 text-sm font-semibold text-red"
              >
                {error}
              </p>
            )}
          </>
        )}

        {written && (
          <article
            className="flex flex-col gap-3 rounded-xl border border-line bg-surface px-5 py-4"
            data-testid="explanation"
          >
            {stale && (
              <p className="text-sm font-semibold text-amber" data-testid="explanation-stale">
                The report has changed since this was written. Explain again to bring it up to date.
              </p>
            )}
            {toBlocks(written.text).map((block, i) =>
              block.kind === 'heading' ? (
                <h3 key={i} className="pt-1 text-sm font-bold">
                  {block.text}
                </h3>
              ) : block.kind === 'list' ? (
                <ul key={i} className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-ink-soft">
                  {block.items.map((item, j) => (
                    <li key={j}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p key={i} className="text-sm leading-relaxed text-ink">
                  {block.text}
                </p>
              ),
            )}
            <p className="border-t border-line pt-3 text-xs text-muted">
              Written by {PROVIDER_NAMES[written.provider]} from the summary above. AI can be wrong: check it against
              the findings.
            </p>
          </article>
        )}
      </div>
    </section>
  );
}
