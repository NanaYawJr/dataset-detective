/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';

/**
 * Content Security Policy for the built site.
 *
 * connect-src 'self' is what backs the privacy promise: the page can only
 * fetch its own files (the DuckDB engine), so it cannot send data elsewhere.
 * 'wasm-unsafe-eval' lets the browser compile the DuckDB WebAssembly module.
 * Applied to production builds only, because the dev server needs live reload.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "connect-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`,
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), contentSecurityPolicy()],
  build: {
    // Emit fonts and images as files instead of inline data: URLs,
    // so the security policy doesn't need to allow data: sources.
    assetsInlineLimit: 0,
  },
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm'],
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
