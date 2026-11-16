# 0009 · Count usage anonymously, on the site's own server

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

The tool is being shared for feedback, and its owner needs to know whether anyone uses it: how many people, how many files, which formats. Until now the site promised no analytics at all, and its security policy lets the page talk only to its own address.

The usual answer is a third-party analytics script. That would mean loosening the security policy to allow another company's server, loading their code into a page that handles people's files, and usually cookies. Each of those undercuts the reason the tool exists.

## Decision

Count on the site's own server, and send as little as possible.

- **Two signals, fixed in shape.** `{"type":"visit"}` when the page opens and `{"type":"profile","kind":"…"}` when a file is profiled, where `kind` is the file format. The server rejects anything else. A test fails if the page ever sends anything about a file.
- **Same address.** The signals go to `/api/event` on the site's own address, so `connect-src 'self'` stays as strict as before. No third party is involved.
- **Daily totals only on disk.** One row per day: visits, distinct visitors, files profiled, distinct people who profiled a file, and a count per format.
- **Distinct people without storing anything about them.** Within a day, a visitor is recognised by a keyed hash of their IP address and browser name. The key is random, lives in memory, is never written to disk, and is replaced at midnight UTC. The hashes are also memory-only. So nothing identifying is stored, and a visitor cannot be linked from one day to the next. No cookie or browser storage is used.
- **Limits.** One visitor counts for at most 20 visits and 100 files a day, and obvious bots are ignored, so the totals can't be swamped.
- **The numbers are private.** `/api/stats` needs a password held in a server variable, compared in constant time, with a lockout after five wrong attempts. The page that shows them is not linked from the site.
- **It is disclosed.** The privacy notice lists the two signals in full, and the upload page and footer say that usage is counted.

The server is a small FastAPI app in the same container as the web server. Caddy passes it only requests under `/api/` and tells it the visitor's address; the app listens only inside the container. The optional explainer planned for a later version will be added to the same server.

## Consequences

- The site can no longer say "no analytics". It says what is counted instead, exactly, and anyone can verify it in their browser's Network tab.
- "Distinct people" is an estimate. Someone on two networks counts twice; several people behind one office address with the same browser count once; a server restart during the day forgets who has already been seen, so they may be counted again that day. Totals across days add each day's count, so a returning visitor is counted once per day they come.
- There is now a server to run and a volume to keep, where before there were only static files. If the counting server is down, the site still works: the signals fail silently.
- Returning users cannot be measured. That was a deliberate trade: it would need an identifier stored in each visitor's browser.
