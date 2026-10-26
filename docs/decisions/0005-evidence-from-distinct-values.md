# 0005 · Gather evidence once per distinct value

- **Status:** Accepted
- **Date:** 2026-10-26

## Context

Deciding a column's type and spotting problems needs many checks on every value: is it a number, a percentage, a date (and which parts are above 12), a placeholder, an email address, an NHS number with a valid check digit, and so on — about 30 checks in all.

The first version ran all of them as one query over every row of every column. It was correct, but on a 330,000-row, 12-column test file it took **61 seconds** — far slower than the 8–11 seconds of the simpler per-column statistics it was meant to replace. The cost was regular expressions: roughly 30 of them on each of 4 million values.

## Decision

1. **Count distinct values first.** Unpivot the table once into a temporary table of `(column, value, rows)`. Every check then runs once per distinct value, and counts are weighted by `rows`. Real files repeat values heavily — dates, categories, codes, statuses — so this removes most of the work.
2. **Cheap pre-checks before any regular expression.** For example, only test the email pattern when the value contains `@`, the date patterns when it starts with a digit and has a plausible length, and the NHS pattern when it is 10–12 characters long. A `CASE` expression guarantees the expensive check is skipped otherwise.
3. **Classify each value once.** Pattern results are computed in a subquery as booleans, then aggregated, so a pattern used by several counts is evaluated once.
4. **Reuse the value-counts table** for top values and value shapes instead of scanning the data again.

## Consequences

- On a deliberately hard test file (330,000 rows, 15 columns, unique IDs, unique amounts, tens of thousands of distinct dates and emails), all checks plus top values and shapes take about **4.3 seconds**, against **10.7 seconds** for the old statistics alone.
- The value-counts table uses memory proportional to the number of distinct values, which for unique columns approaches the number of rows. This is acceptable for files that fit in the browser.
- Evidence is exact, not sampled: a finding such as "300 rows use a placeholder" is a true count.
