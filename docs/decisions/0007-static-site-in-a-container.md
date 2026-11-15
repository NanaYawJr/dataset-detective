# 0007 · Serve the static site from a small container

- **Status:** Accepted
- **Date:** 2026-11-15

## Context

The app is a static site, so a static host would normally be the simplest choice. Two things rule out the obvious ones:

- The DuckDB engine files are 34 MB and 39 MB. Cloudflare Pages limits each file to 25 MB.
- The privacy promise depends on response headers. `frame-ancestors`, `Strict-Transport-Security` and `X-Content-Type-Options` cannot be set from a `<meta>` tag, and GitHub Pages does not allow custom headers at all.

A later milestone also needs a small server for the optional explainer, and that will be hosted on Railway.

## Decision

Build the site into a two-stage container and run it on Railway:

1. **Build stage:** Node builds the site, then every text-like file is compressed once with Brotli and gzip.
2. **Run stage:** Caddy and the built files, nothing else. Caddy sends the security headers, serves the pre-compressed copies, caches fingerprinted files for a year and re-checks the page itself on every visit.

The Content Security Policy is sent as a header **and** kept in the page's `<meta>` tag. The browser enforces both. The header adds `frame-ancestors 'none'`, so the site cannot be embedded in another page; the tag means the policy still applies if the files are ever served by something else. A unit test keeps the two identical.

Caddy is configured without an access log.

## Consequences

- The first visit downloads about 6 MB for the engine instead of 34 MB. Later visits use the browser's cache.
- Hosting costs a little (a container that is always on) where a static host would be free. In return the headers are under the project's control and the explainer service can sit alongside it.
- The running container has no Node, no source code and no shell tools beyond the base image, so there is little to attack.
- The hosting provider still sees ordinary request details (address, time, path) in order to deliver the site. `PRIVACY.md` says so.
