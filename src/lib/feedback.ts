import type { SourceKind } from './source/types';

/** Feedback from the people using the tool. See api/app/feedback.py and PRIVACY.md. */

export const APP_VERSION = __APP_VERSION__;

export interface FeedbackDraft {
  rating: number;
  comment: string;
  wantsReply: boolean;
  name: string;
  country: string;
  email: string;
  /** The hidden field bots fill in. People never see it. */
  website: string;
}

export interface FeedbackEntry {
  id: number;
  created_at: string;
  rating: number;
  comment: string;
  wants_reply: boolean;
  name: string;
  country: string;
  email: string;
  app_version: string;
  file_kind: string;
}

export interface FeedbackList {
  count: number;
  average: number | null;
  ratings: Record<string, number>;
  entries: FeedbackEntry[];
  retention_days: number;
  alerts: boolean;
}

export const COUNTRIES = [
  'United Kingdom',
  'Ireland',
  'Canada',
  'United States',
  'Ghana',
  'Nigeria',
  'India',
  'Australia',
  'Other',
];

const EMAIL = /^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$/;
export const isEmail = (text: string) => EMAIL.test(text.trim());

/** The exact request body. Contact details are left out unless a reply was asked for. */
export function feedbackBody(draft: FeedbackDraft, fileKind: SourceKind | null): Record<string, unknown> {
  return {
    rating: draft.rating,
    comment: draft.comment.trim(),
    wants_reply: draft.wantsReply,
    ...(draft.wantsReply ? { name: draft.name.trim(), country: draft.country, email: draft.email.trim() } : {}),
    app_version: APP_VERSION,
    file_kind: fileKind ?? '',
    website: draft.website,
  };
}

async function detail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === 'string') return body.detail;
  } catch {
    // Fall through.
  }
  return `The server answered with an error (${response.status}).`;
}

export async function sendFeedback(
  draft: FeedbackDraft,
  fileKind: SourceKind | null,
): Promise<{ ok: boolean; message?: string }> {
  try {
    const response = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(feedbackBody(draft, fileKind)),
    });
    return response.ok ? { ok: true } : { ok: false, message: await detail(response) };
  } catch {
    return { ok: false, message: "Your feedback couldn't be sent. Check your connection and try again." };
  }
}

export async function fetchFeedback(
  password: string,
): Promise<{ ok: true; list: FeedbackList } | { ok: false; message: string }> {
  try {
    const response = await fetch('/api/feedback', {
      headers: { Authorization: `Bearer ${password}` },
      cache: 'no-store',
    });
    return response.ok
      ? { ok: true, list: (await response.json()) as FeedbackList }
      : { ok: false, message: await detail(response) };
  } catch {
    return { ok: false, message: "The server couldn't be reached." };
  }
}

export async function deleteFeedback(password: string, id: number): Promise<boolean> {
  try {
    const response = await fetch(`/api/feedback/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${password}` },
    });
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

/** The feedback as a CSV file, for keeping or opening in Excel. */
export function feedbackCsv(entries: FeedbackEntry[]): string {
  const columns: (keyof FeedbackEntry)[] = [
    'created_at',
    'rating',
    'comment',
    'wants_reply',
    'name',
    'country',
    'email',
    'app_version',
    'file_kind',
  ];
  const field = (value: unknown) => {
    let text = String(value ?? '');
    // A leading = + - @ would run as a formula in a spreadsheet.
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return (
    [columns.join(','), ...entries.map((entry) => columns.map((c) => field(entry[c])).join(','))].join('\r\n') + '\r\n'
  );
}
