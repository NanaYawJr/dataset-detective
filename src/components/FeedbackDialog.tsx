import { useEffect, useRef, useState, type FormEvent } from 'react';
import { APP_VERSION, COUNTRIES, isEmail, sendFeedback, type FeedbackDraft } from '../lib/feedback';
import type { SourceKind } from '../lib/source/types';

const KIND_NAMES: Record<SourceKind, string> = { delimited: 'CSV', excel: 'Excel', parquet: 'Parquet', json: 'JSON' };

const PROMPTS: Record<number, string> = {
  1: 'What went wrong?',
  2: 'What went wrong?',
  3: 'What would make it better?',
  4: 'What did you find most useful?',
  5: 'What did you find most useful?',
};

const EMPTY: FeedbackDraft = {
  rating: 0,
  comment: '',
  wantsReply: false,
  name: '',
  country: '',
  email: '',
  website: '',
};

interface FeedbackDialogProps {
  open: boolean;
  /** The format of the file being looked at, if any: sent so feedback can be matched to it. */
  fileKind: SourceKind | null;
  onClose: () => void;
}

/** A short feedback form. Only the rating is required; contact details only if a reply is wanted. */
export function FeedbackDialog({ open, fileKind, onClose }: FeedbackDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<FeedbackDraft>(EMPTY);
  const [errors, setErrors] = useState<{ rating?: string; email?: string; send?: string }>({});
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  const update = (changes: Partial<FeedbackDraft>) => {
    setDraft((current) => ({ ...current, ...changes }));
    setErrors((current) => ({
      ...current,
      ...('rating' in changes ? { rating: undefined } : {}),
      ...('email' in changes || 'wantsReply' in changes ? { email: undefined } : {}),
      send: undefined,
    }));
  };

  const close = () => {
    onClose();
    // Start afresh next time, unless the person was halfway through and simply closed it.
    if (sent) {
      setDraft(EMPTY);
      setSent(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found: typeof errors = {};
    if (draft.rating === 0) found.rating = 'Choose a rating first';
    if (draft.wantsReply && !isEmail(draft.email))
      found.email = 'Enter an email so a reply can reach you, or untick the box';
    if (found.rating || found.email) {
      setErrors(found);
      return;
    }
    setBusy(true);
    const result = await sendFeedback(draft, fileKind);
    setBusy(false);
    if (result.ok) setSent(true);
    else setErrors({ send: result.message });
  };

  const field = 'min-h-11 w-full rounded-lg border border-line-strong bg-white px-3 text-sm text-ink';

  return (
    <dialog
      ref={dialog}
      onClose={close}
      aria-labelledby="feedback-heading"
      className="m-auto w-[min(36rem,calc(100%-2rem))] rounded-2xl border border-line bg-white p-0 text-ink shadow-xl backdrop:bg-ink/40"
    >
      {sent ? (
        <div className="flex flex-col items-center gap-3 px-6 py-10 text-center" data-testid="feedback-thanks">
          <h2 id="feedback-heading" className="text-xl font-extrabold">
            Thanks, that helps
          </h2>
          <p className="text-sm text-ink-soft">
            {draft.wantsReply
              ? `You rated it ${draft.rating} out of 5. Expect a reply by email.`
              : `You rated it ${draft.rating} out of 5.`}
          </p>
          <button
            type="button"
            onClick={close}
            className="mt-2 min-h-11 rounded-xl border border-line-strong px-5 font-bold"
          >
            Close
          </button>
        </div>
      ) : (
        <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-5 px-6 py-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="feedback-heading" className="text-xl font-extrabold">
                Was this useful?
              </h2>
              <p className="mt-1 text-sm text-muted">Tell me in 30 seconds. Only the rating is needed.</p>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="-mr-2 -mt-1 flex size-11 shrink-0 items-center justify-center rounded-lg text-2xl leading-none text-muted hover:bg-surface hover:text-ink"
            >
              ×
            </button>
          </div>

          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-ink-soft">
              How useful was Dataset Detective?{' '}
              <span className="font-normal text-muted">(1 = not at all, 5 = very)</span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {[1, 2, 3, 4, 5].map((value) => (
                <label key={value} className="cursor-pointer">
                  <input
                    type="radio"
                    name="rating"
                    value={value}
                    checked={draft.rating === value}
                    onChange={() => update({ rating: value })}
                    className="peer sr-only"
                  />
                  <span className="flex h-11 min-w-13 items-center justify-center rounded-lg border border-line-strong px-4 font-bold peer-checked:border-teal peer-checked:bg-teal peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-teal peer-focus-visible:ring-offset-2">
                    {value}
                  </span>
                </label>
              ))}
            </div>
            {errors.rating && (
              <p className="mt-2 text-sm font-semibold text-red" role="alert">
                {errors.rating}
              </p>
            )}
          </fieldset>

          <label className="flex flex-col gap-2 text-sm font-semibold text-ink-soft">
            <span>
              {PROMPTS[draft.rating] ?? 'What would make it better?'}{' '}
              <span className="font-normal text-muted">(optional)</span>
            </span>
            <textarea
              rows={3}
              maxLength={2000}
              value={draft.comment}
              onChange={(e) => update({ comment: e.target.value })}
              placeholder="It said my dates were month-first, but they're day-first"
              className="w-full resize-y rounded-lg border border-line-strong bg-white px-3 py-2 text-sm font-normal text-ink"
            />
          </label>

          {/* Hidden from people and screen readers; only bots fill it in. */}
          <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
            <label>
              Website
              <input
                tabIndex={-1}
                autoComplete="off"
                value={draft.website}
                onChange={(e) => update({ website: e.target.value })}
              />
            </label>
          </div>

          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold">
            <input
              type="checkbox"
              checked={draft.wantsReply}
              onChange={(e) => update({ wantsReply: e.target.checked })}
              className="size-4 accent-teal"
            />
            I'd like a reply about this
          </label>

          {draft.wantsReply && (
            <div className="flex flex-col gap-3 rounded-xl border border-line p-4" data-testid="feedback-contact">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                  Name (optional)
                  <input
                    autoComplete="name"
                    value={draft.name}
                    maxLength={100}
                    onChange={(e) => update({ name: e.target.value })}
                    className={field}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                  Country (optional)
                  <select value={draft.country} onChange={(e) => update({ country: e.target.value })} className={field}>
                    <option value="">Choose…</option>
                    {COUNTRIES.map((country) => (
                      <option key={country}>{country}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                Email
                <input
                  type="email"
                  autoComplete="email"
                  value={draft.email}
                  maxLength={254}
                  onChange={(e) => update({ email: e.target.value })}
                  placeholder="name@company.com"
                  className={field}
                />
              </label>
              {errors.email && (
                <p className="text-sm font-semibold text-red" role="alert">
                  {errors.email}
                </p>
              )}
              <p className="text-xs leading-relaxed text-muted">
                Used only to reply to this feedback, and sent to me by email. Deleted after 12 months, or sooner if you
                ask.
              </p>
            </div>
          )}

          <p className="rounded-lg bg-surface px-3 py-2 text-xs leading-relaxed text-ink-soft">
            Sent with it: app version {APP_VERSION}
            {fileKind ? ` and file type (${KIND_NAMES[fileKind]})` : ''}. Never your file, its name or its contents.
          </p>

          {errors.send && (
            <p
              className="rounded-xl border border-[#e9b8b2] bg-red-tint px-4 py-3 text-sm font-semibold text-red"
              role="alert"
            >
              {errors.send}
            </p>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={close}
              className="min-h-11 rounded-xl px-5 text-sm font-bold text-ink-soft hover:text-ink"
            >
              Not now
            </button>
            <button
              type="submit"
              disabled={busy}
              className="min-h-11 rounded-xl bg-teal px-5 text-sm font-bold text-white hover:bg-teal-dark disabled:opacity-60"
            >
              {busy ? 'Sending…' : 'Send feedback'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
