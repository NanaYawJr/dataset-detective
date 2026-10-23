# 0002 · Read every value as text; let rules decide types

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

CSV readers, including DuckDB's, sniff each column and pick a type. That is convenient but wrong in exactly the cases this tool exists to catch:

- `03/04/2026` is parsed with whatever date order the reader guesses. UK files are usually day-first, US files month-first, and Canadian files can be either — or ISO.
- `"5%"` stays text, while `00123` loses its leading zeros as a number.
- A column that is mostly numbers with one stray `N/A` becomes text, hiding the real issue.

## Decision

Load every column with `all_varchar = true`. Type decisions are made by the rule engine (stage 2), from evidence it can show the user — for example, "day-first, because 214 values have a first part above 12".

## Consequences

- No value is ever silently converted. What the user sees in the report is exactly what is in the file.
- Numeric statistics such as mean and median wait until a column has been decided as numeric.
- The region setting supplies a suggested date order only when the evidence is inconclusive, and the suggestion is always shown, never applied silently.
