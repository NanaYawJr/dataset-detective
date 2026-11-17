import type { ReportSummary } from './summary';

/** Talks to the site's own server, which calls the model. The page never contacts a model provider itself. */

export type Provider = 'anthropic' | 'openai';
export const PROVIDER_NAMES: Record<Provider, string> = { anthropic: 'Claude', openai: 'OpenAI' };

export interface ExplainStatus {
  enabled: boolean;
  /** Free explanations, on the site's keys, can be used now. */
  available: boolean;
  /** Free explanations left today for this visitor. */
  remaining: number;
  /** A visitor may use their own key. */
  own_key: boolean;
}

export type ExplainResult = { ok: true; text: string; provider: Provider } | { ok: false; message: string };

async function detail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === 'string') return body.detail;
  } catch {
    // Fall through to the generic message.
  }
  return `The server answered with an error (${response.status}).`;
}

export async function fetchExplainStatus(): Promise<ExplainStatus | null> {
  try {
    const response = await fetch('/api/explain', { cache: 'no-store' });
    return response.ok ? ((await response.json()) as ExplainStatus) : null;
  } catch {
    return null;
  }
}

export async function requestExplanation(
  summary: ReportSummary,
  own?: { provider: Provider; apiKey: string },
): Promise<ExplainResult> {
  try {
    const response = await fetch('/api/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(own ? { summary, provider: own.provider, api_key: own.apiKey } : { summary }),
      cache: 'no-store',
    });
    if (!response.ok) return { ok: false, message: await detail(response) };
    const body = (await response.json()) as { text: string; provider: Provider };
    return { ok: true, text: body.text, provider: body.provider };
  } catch {
    return { ok: false, message: "The server couldn't be reached. Check your connection and try again." };
  }
}

/** The model's plain text as blocks: paragraphs, headings ("What to fix first:") and bullet lists. */
export type Block = { kind: 'paragraph' | 'heading'; text: string } | { kind: 'list'; items: string[] };

export function toBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      const last = blocks[blocks.length - 1];
      const item = bullet[1].replace(/\*\*/g, '');
      if (last?.kind === 'list') last.items.push(item);
      else blocks.push({ kind: 'list', items: [item] });
      continue;
    }
    const clean = line.replace(/^#+\s*/, '').replace(/\*\*/g, '');
    if (clean.endsWith(':') && clean.length <= 60) blocks.push({ kind: 'heading', text: clean.slice(0, -1) });
    else blocks.push({ kind: 'paragraph', text: clean });
  }
  return blocks;
}
