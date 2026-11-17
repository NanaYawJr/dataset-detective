import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { formatDate, formatNumber, type Region } from '../lib/region';
import type { SourceKind } from '../lib/source/types';
import { fetchStats, type UsageSummary } from '../lib/usage';
import { FeedbackView } from './FeedbackView';

const STORAGE_KEY = 'dataset-detective.stats-password';
const KIND_NAMES: Record<SourceKind, string> = {
  delimited: 'CSV / text',
  excel: 'Excel',
  parquet: 'Parquet',
  json: 'JSON',
};
const KINDS = Object.keys(KIND_NAMES) as SourceKind[];

function remembered(): string {
  try {
    return sessionStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function remember(password: string | null): void {
  try {
    if (password === null) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, password);
  } catch {
    // Private windows may refuse storage; the password is then asked for again after a refresh.
  }
}

/** A private page: usage totals, shown only to someone who has the server's password. */
export function StatsPage({ region }: { region: Region }) {
  const [password, setPassword] = useState('');
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [message, setMessage] = useState('');
  const [view, setView] = useState<'usage' | 'feedback'>('usage');
  // After a refresh in the same tab, the remembered password signs in again.
  const [busy, setBusy] = useState(() => remembered() !== '');

  const show = (candidate: string, result: Awaited<ReturnType<typeof fetchStats>>) => {
    setBusy(false);
    if (result.ok) {
      setSummary(result.summary);
      remember(candidate);
    } else {
      setSummary(null);
      setMessage(result.message);
      remember(null);
    }
  };

  const load = (candidate: string) => {
    setBusy(true);
    setMessage('');
    void fetchStats(candidate).then((result) => show(candidate, result));
  };

  useEffect(() => {
    const saved = remembered();
    if (!saved) return;
    let current = true;
    void fetchStats(saved).then((result) => {
      if (current) show(saved, result);
    });
    return () => {
      current = false;
    };
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (password) load(password);
  };

  const signOut = () => {
    remember(null);
    setSummary(null);
    setPassword('');
  };

  if (!summary) {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-5 px-4 py-16 sm:px-6">
        <h1 className="text-3xl font-extrabold tracking-tight">Usage</h1>
        <p className="text-ink-soft">This page is private. Enter the password set on the server.</p>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm font-semibold text-muted">
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="min-h-11 rounded-xl border border-line-strong bg-white px-3 text-base font-semibold text-ink"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !password}
            className="min-h-11 rounded-xl bg-teal px-5 font-bold text-white hover:bg-teal-dark disabled:opacity-60"
          >
            {busy ? 'Checking…' : 'Show usage'}
          </button>
        </form>
        {message && (
          <p
            role="alert"
            className="rounded-xl border border-[#e9b8b2] bg-red-tint px-4 py-3 text-sm font-semibold text-red"
          >
            {message}
          </p>
        )}
      </main>
    );
  }

  const { totals, formats, days } = summary;
  const n = (value: number) => formatNumber(value, region);

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-extrabold tracking-tight">{view === 'usage' ? 'Usage' : 'Feedback'}</h1>
          <div role="tablist" aria-label="Private pages" className="flex w-fit gap-1 rounded-xl bg-surface p-1">
            {(['usage', 'feedback'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={view === tab}
                onClick={() => setView(tab)}
                className={`min-h-11 rounded-lg px-4 text-sm font-bold ${view === tab ? 'bg-white text-ink shadow-sm' : 'text-ink-soft hover:text-ink'}`}
              >
                {tab === 'usage' ? 'Usage' : 'Feedback'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-3">
          {view === 'usage' && (
            <button
              type="button"
              onClick={() => load(remembered())}
              className="min-h-11 rounded-xl border border-line-strong bg-white px-5 font-bold text-ink hover:bg-surface"
            >
              Refresh
            </button>
          )}
          <button
            type="button"
            onClick={signOut}
            className="min-h-11 rounded-xl border border-line-strong bg-white px-5 font-bold text-ink hover:bg-surface"
          >
            Sign out
          </button>
        </div>
      </div>

      {view === 'feedback' ? (
        <FeedbackView password={remembered()} region={region} />
      ) : (
        <>
          <p className="-mt-2 text-ink-soft">
            Anonymous counts. Nothing about anyone's file is recorded, and nobody is tracked from one day to the next.
          </p>

          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Totals">
            <Tile label="People who used it" value={n(totals.users)} testId="total-users">
              Profiled at least one file, counted per day
            </Tile>
            <Tile label="Files profiled" value={n(totals.profiles)} testId="total-profiles">
              {KINDS.filter((kind) => formats[kind])
                .map((kind) => `${n(formats[kind] ?? 0)} ${KIND_NAMES[kind]}`)
                .join(' · ') || 'None yet'}
            </Tile>
            <Tile label="Visitors" value={n(totals.visitors)} testId="total-visitors">
              Opened the site, counted per day
            </Tile>
            <Tile label="Visits" value={n(totals.visits)} testId="total-visits">
              Every time the site was opened
            </Tile>
          </section>

          <p className="text-sm text-muted">
            People are counted once per day and can't be recognised on a later day, so someone who comes back on three
            days counts three times in the totals. A restart of the server during a day can count the same person twice
            that day.
          </p>

          <section className="overflow-hidden rounded-2xl border border-line bg-white" aria-labelledby="days-heading">
            <div className="border-b border-line px-5 py-4">
              <h2 id="days-heading" className="text-lg font-extrabold">
                Day by day
              </h2>
            </div>
            {days.length === 0 ? (
              <p className="px-5 py-6 text-ink-soft">Nothing has been counted yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                      <th scope="col" className="px-5 py-3 font-bold">
                        Day (UTC)
                      </th>
                      {['People who used it', 'Files profiled', 'Visitors', 'Visits'].map((heading) => (
                        <th key={heading} scope="col" className="px-5 py-3 text-right font-bold">
                          {heading}
                        </th>
                      ))}
                      <th scope="col" className="px-5 py-3 font-bold">
                        Formats
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {days.map((day) => (
                      <tr key={day.day} className="border-b border-line last:border-b-0" data-testid={`day-${day.day}`}>
                        <th scope="row" className="whitespace-nowrap px-5 py-3 text-left font-semibold">
                          {formatDate(new Date(`${day.day}T00:00:00Z`), region)}
                        </th>
                        {[day.users, day.profiles, day.visitors, day.visits].map((value, i) => (
                          <td key={i} className="px-5 py-3 text-right font-mono">
                            {n(value)}
                          </td>
                        ))}
                        <td className="px-5 py-3 text-ink-soft">
                          {KINDS.filter((kind) => day.kinds[kind])
                            .map((kind) => `${n(day.kinds[kind] ?? 0)} ${KIND_NAMES[kind]}`)
                            .join(' · ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function Tile({
  label,
  value,
  testId,
  children,
}: {
  label: string;
  value: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-2xl border border-line bg-white px-5 py-4">
      <span className="text-sm font-semibold text-muted">{label}</span>
      <span className="text-2xl font-extrabold" data-testid={testId}>
        {value}
      </span>
      <span className="text-sm text-muted">{children}</span>
    </div>
  );
}
