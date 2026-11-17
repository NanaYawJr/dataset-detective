import { useCallback, useEffect, useState } from 'react';
import { deleteFeedback, feedbackCsv, fetchFeedback, type FeedbackEntry, type FeedbackList } from '../lib/feedback';
import { formatDate, formatNumber, type Region } from '../lib/region';

const KIND_NAMES: Record<string, string> = { delimited: 'CSV', excel: 'Excel', parquet: 'Parquet', json: 'JSON' };

/** The owner's view of feedback: newest first, with contact details for those who asked for a reply. */
export function FeedbackView({ password, region }: { password: string; region: Region }) {
  const [list, setList] = useState<FeedbackList | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(true);

  const load = useCallback(async () => {
    setBusy(true);
    const result = await fetchFeedback(password);
    setBusy(false);
    if (result.ok) {
      setList(result.list);
      setMessage('');
    } else setMessage(result.message);
  }, [password]);

  useEffect(() => {
    let current = true;
    void fetchFeedback(password).then((result) => {
      if (!current) return;
      setBusy(false);
      if (result.ok) setList(result.list);
      else setMessage(result.message);
    });
    return () => {
      current = false;
    };
  }, [password]);

  const remove = async (entry: FeedbackEntry) => {
    if (!(await deleteFeedback(password, entry.id))) {
      setMessage("That feedback couldn't be deleted. Try again.");
      return;
    }
    await load();
  };

  const download = () => {
    if (!list) return;
    const url = URL.createObjectURL(new Blob([feedbackCsv(list.entries)], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `dataset-detective-feedback-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const n = (value: number) => formatNumber(value, region);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-soft">
          Kept for {list?.retention_days === 365 ? '12 months' : `${list?.retention_days ?? 365} days`}, then deleted
          automatically. Contact details are kept only for people who asked for a reply.
          {list &&
            !list.alerts &&
            ' Email alerts are off: set RESEND_API_KEY and FEEDBACK_EMAIL_TO on the server to turn them on.'}
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => void load()}
            className="min-h-11 rounded-xl border border-line-strong bg-white px-5 font-bold text-ink hover:bg-surface"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={download}
            disabled={!list || list.count === 0}
            className="min-h-11 rounded-xl border border-line-strong bg-white px-5 font-bold text-ink hover:bg-surface disabled:opacity-50"
          >
            Download CSV
          </button>
        </div>
      </div>

      {message && (
        <p
          role="alert"
          className="rounded-xl border border-[#e9b8b2] bg-red-tint px-4 py-3 text-sm font-semibold text-red"
        >
          {message}
        </p>
      )}

      {busy && !list && <p className="text-ink-soft">Loading…</p>}

      {list && (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Feedback totals">
            <div className="flex flex-col gap-1 rounded-2xl border border-line bg-white px-5 py-4">
              <span className="text-sm font-semibold text-muted">Responses</span>
              <span className="text-2xl font-extrabold" data-testid="feedback-count">
                {n(list.count)}
              </span>
            </div>
            <div className="flex flex-col gap-1 rounded-2xl border border-line bg-white px-5 py-4">
              <span className="text-sm font-semibold text-muted">Average rating</span>
              <span className="text-2xl font-extrabold" data-testid="feedback-average">
                {list.average === null ? '–' : `${list.average.toFixed(1)} / 5`}
              </span>
            </div>
            <div className="col-span-2 flex flex-col gap-2 rounded-2xl border border-line bg-white px-5 py-4">
              <span className="text-sm font-semibold text-muted">Ratings</span>
              <div className="flex items-end gap-3" aria-label="How many of each rating">
                {[5, 4, 3, 2, 1].map((rating) => (
                  <span key={rating} className="text-sm">
                    <strong>{rating}</strong>{' '}
                    <span className="text-muted">× {n(list.ratings[String(rating)] ?? 0)}</span>
                  </span>
                ))}
              </div>
            </div>
          </section>

          {list.count === 0 ? (
            <p className="rounded-2xl border border-line bg-white px-5 py-6 text-ink-soft">No feedback yet.</p>
          ) : (
            <ul
              className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-white"
              data-testid="feedback-entries"
            >
              {list.entries.map((entry) => (
                <li key={entry.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-start sm:gap-5">
                  <div className="flex shrink-0 items-center gap-3 sm:w-36 sm:flex-col sm:items-start sm:gap-1">
                    <span
                      className="rounded-full bg-surface px-3 py-1 text-sm font-extrabold"
                      aria-label={`Rated ${entry.rating} out of 5`}
                    >
                      {entry.rating} / 5
                    </span>
                    <span className="text-xs text-muted">{formatDate(new Date(entry.created_at), region)}</span>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <p
                      className={`whitespace-pre-line break-words text-sm leading-relaxed ${entry.comment ? 'text-ink' : 'text-muted'}`}
                    >
                      {entry.comment || 'No comment.'}
                    </p>
                    {entry.wants_reply && (
                      <p className="text-sm text-ink-soft">
                        <strong className="text-ink">Wants a reply:</strong>{' '}
                        {[entry.name, entry.country].filter(Boolean).join(', ')}
                        {(entry.name || entry.country) && ' · '}
                        <a
                          className="font-semibold text-teal-dark underline"
                          href={`mailto:${entry.email}?subject=${encodeURIComponent('Your Dataset Detective feedback')}`}
                        >
                          {entry.email}
                        </a>
                      </p>
                    )}
                    <p className="text-xs text-muted">
                      {[entry.app_version && `Version ${entry.app_version}`, KIND_NAMES[entry.file_kind]]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void remove(entry)}
                    className="min-h-11 shrink-0 self-start rounded-xl px-4 text-sm font-bold text-red hover:bg-red-tint"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
