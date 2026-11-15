import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The security policy is written in two places: the page's own <meta> tag
 * (vite.config.ts) and the web server's header (Caddyfile). The browser
 * enforces both, so they must say the same thing.
 */

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');

function pagePolicy(): string[] {
  const list = /CONTENT_SECURITY_POLICY = \[([\s\S]*?)\]/.exec(read('vite.config.ts'))?.[1] ?? '';
  return [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function serverPolicy(): string[] {
  const header = /Content-Security-Policy "([^"]+)"/.exec(read('Caddyfile'))?.[1] ?? '';
  return header.split('; ');
}

describe('security policy', () => {
  it('is the same on the page and on the server, plus frame-ancestors', () => {
    expect(pagePolicy().length).toBeGreaterThan(5);
    expect(serverPolicy()).toEqual([...pagePolicy(), "frame-ancestors 'none'"]);
  });

  it('only ever allows the site to talk to itself', () => {
    expect(serverPolicy()).toContain("connect-src 'self'");
    expect(serverPolicy()).toContain("default-src 'none'");
  });
});
