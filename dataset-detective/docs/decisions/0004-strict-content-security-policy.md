# 0004 · Enforce "nothing leaves your browser" with a strict Content Security Policy

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

"Your data never leaves your browser" is easy to claim and easy to break by accident — a third-party analytics script, a font from a CDN, or a library that fetches something at runtime. The claim should be enforced by the browser, not just intended.

## Decision

The production build adds this policy to the page (see `vite.config.ts`):

| Directive                 | Value                       | Why                                                                      |
| ------------------------- | --------------------------- | ------------------------------------------------------------------------ |
| `default-src`             | `'none'`                    | Deny everything not explicitly allowed.                                  |
| `script-src`              | `'self' 'wasm-unsafe-eval'` | Own scripts only; allow compiling the DuckDB WebAssembly module.         |
| `worker-src`              | `'self'`                    | DuckDB's worker comes from the site.                                     |
| `connect-src`             | `'self'`                    | The page can fetch only its own files, so it cannot send data elsewhere. |
| `style-src`, `font-src`   | `'self'`                    | Styles and fonts are bundled; nothing from Google Fonts or a CDN.        |
| `img-src`                 | `'self' data:`              | Own images.                                                              |
| `base-uri`, `form-action` | `'none'`                    | No base-URL hijacking, no form submissions.                              |

Supporting choices: fonts are self-hosted, assets are never inlined as `data:` URLs (`assetsInlineLimit: 0`), and DuckDB's automatic extension downloads are switched off.

The policy is applied to production builds only, because the development server needs live reload.

## Consequences

- Browser tests run against the production build and fail on any console error, so a policy violation is caught in CI. (This caught a font that Vite had inlined as a `data:` URL.)
- A future opt-in explainer will need exactly one additional `connect-src` origin: the project's own proxy. That change will be deliberate, visible in review, and documented in the privacy note.
- When hosting, the same policy should also be sent as an HTTP header, which additionally allows `frame-ancestors 'none'` to prevent the site being embedded elsewhere.
