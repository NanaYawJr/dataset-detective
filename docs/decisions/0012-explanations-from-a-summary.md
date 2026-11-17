# 0012 · Explain a report from a summary that holds no values

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

A profile is precise but dense. Many people who receive one want two sentences and a short list: is this file usable, and what should be fixed first? A language model writes that well.

The tool's promise is that files never leave the browser. Sending a file, or even samples of its values, to a model provider would break that promise. Sending column names and counts does not reveal the data, but it does reveal its shape, so it has to be optional and disclosed.

The page's security policy lets it talk only to its own address, and loosening it to call a provider directly would also expose the owner's API keys.

## Decision

1. **Send a summary, not the data.** `buildSummary` takes the shape of the report: file format and size, and for each column its name, type, role, share of missing values and number of distinct values; the titles of findings with the rows they affect; and, after a comparison, a value-free form of each change ("the largest value more than doubled", not the value). It never includes rows, top values, examples, minimums, maximums, averages, dates, file names or any finding's detail text. Anything in quotation marks is masked as a second guard.
2. **Prove it.** A test plants unmistakable values everywhere a profile can hold them and fails if any appears in the summary. On the server, a strict schema (no unknown fields, length limits) rejects anything that isn't a summary, so a future change on the page can't widen what is sent without changing the server too.
3. **Only when asked, and visibly.** Nothing is sent until the visitor clicks. The exact summary can be read first, and the privacy notice lists its contents.
4. **Through the site's own server.** The page posts to `/api/explain`; the server adds the instructions and calls Claude, then OpenAI if Claude fails. The keys stay on the server and the page's policy is unchanged.
5. **Bounded cost.** Free explanations are limited per visitor (in memory, the same way as usage counts) and per site per day (on disk, so restarts don't reset it). A request is counted before it is made and refunded if it fails. An off switch and provider-side spending limits sit behind that.
6. **A visitor's own key.** It is sent with the one request, used, and dropped: not stored, not logged, not kept in the page's storage. Such requests don't use the free allowance, but still have a generous daily limit so the server can't be used as an open relay.
7. **The answer is text.** The model is told that column names and titles are data and not instructions, and its answer is rendered as plain text (paragraphs, headings, bullets), never as HTML. It is labelled as written by AI, with a reminder to check it against the findings.

## Consequences

- Column names do reach the provider. For most files they are harmless; for some they are not, and the notice says so plainly.
- An explanation can only be as good as the summary: the model can't see the values, so it can't spot anything the profile didn't. That is the intended trade.
- There is now a cost per use. With Haiku and the default limits, the most the site can spend in a day is small and known in advance.
- Without keys on the server the feature still works for visitors with their own key; with `EXPLAIN_ENABLED=0` it disappears from the page.
