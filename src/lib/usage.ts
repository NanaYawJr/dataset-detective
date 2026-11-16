import type { SourceKind } from './source/types';

/**
 * Anonymous usage counting. The page tells its own server two things and
 * nothing else: that it was opened, and that a file of some format was
 * profiled. No file name, size, column or value is ever sent, and nothing
 * is stored in the browser. See PRIVACY.md.
 */

export type UsageEvent = { type: 'visit' } | { type: 'profile'; kind: SourceKind };

export interface UsageDay {
  day: string;
  visits: number;
  visitors: number;
  profiles: number;
  users: number;
  kinds: Partial<Record<SourceKind, number>>;
}

export interface UsageSummary {
  totals: { visits: number; visitors: number; profiles: number; users: number };
  formats: Partial<Record<SourceKind, number>>;
  days: UsageDay[];
}

/** The exact request body, kept in one place so it can be tested and read. */
export function usageBody(event: UsageEvent): string {
  return JSON.stringify(event.type === 'profile' ? { type: event.type, kind: event.kind } : { type: event.type });
}

export function reportUsage(event: UsageEvent): void {
  // Only the published site counts; local development and tests do not.
  if (!import.meta.env.PROD) return;
  try {
    void fetch('/api/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: usageBody(event),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Counting must never get in the way of using the tool.
  }
}

export type StatsResult = { ok: true; summary: UsageSummary } | { ok: false; message: string };

export async function fetchStats(password: string): Promise<StatsResult> {
  try {
    const response = await fetch('/api/stats', { headers: { Authorization: `Bearer ${password}` }, cache: 'no-store' });
    if (response.ok) return { ok: true, summary: (await response.json()) as UsageSummary };
    const detail = await response
      .json()
      .then((body: { detail?: unknown }) => (typeof body.detail === 'string' ? body.detail : ''))
      .catch(() => '');
    return { ok: false, message: detail || `The server answered with an error (${response.status}).` };
  } catch {
    return { ok: false, message: "The server couldn't be reached." };
  }
}
