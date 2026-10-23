# 0003 · Rules decide; a language model may only explain

- **Status:** Accepted (the explainer itself is planned for 0.6)
- **Date:** 2026-10-21

## Context

A language model could summarise a profile in plain English and guess what cryptic column names mean. But a profile is only useful if it is **repeatable** (the same file gives the same findings) and **auditable** (each finding can state its evidence). Model output is neither guaranteed to be repeatable nor always able to show its working.

## Decision

- Every finding comes from a deterministic, tested rule.
- A model may be used only to **explain** findings that already exist. It cannot add, remove or change them.
- Any figure in a model's explanation is checked against the profile before it is shown, and the text is labelled as generated.

## Consequences

- The core product works fully without any model, and without any network access.
- When the explainer is added, it will need a small server-side proxy so that API keys are never exposed in the browser. The proxy will accept only a masked summary of the profile — never rows — and will be rate-limited, bot-checked, origin-restricted and capped by provider spending limits.
- Using the explainer will be opt-in, with a preview of exactly what will be sent.
