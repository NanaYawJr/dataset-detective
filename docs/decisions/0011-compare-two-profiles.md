# 0011 · Compare two files by profiling both, and match rows only on a proven key

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

Most files people profile arrive repeatedly: a monthly extract, a weekly feed. The question after "is this file sound?" is "what changed since last time?" A new column, a renamed one, a category value nobody has seen before, a fall in rows: each of these breaks reports quietly.

A row-by-row diff is the obvious tool, but it is only meaningful when rows can be matched. Matching on position is wrong as soon as a row is inserted, and matching on a column that repeats produces a cross join that reports nonsense.

## Decision

1. **Profile the earlier file the same way.** It goes through the same reading, evidence and rules into its own table, so the two profiles are directly comparable and the comparison is mostly a comparison of profiles. The privacy model is unchanged: both files stay in the browser.
2. **Describe changes, not raw numbers.** `compareProfiles` turns differences into sentences with a severity: a change of type or date order is serious (the same text now means something else); new missing values or a new category value is a warning; a shift in an average is a note unless it is large. Small movements are not reported.
3. **Treat near-identical names as renames.** Columns whose names differ only in case, spaces or punctuation (`order_date`, `Order Date`) are reported as renamed, not as one removed and one added.
4. **Match rows only on a proven key.** Rows are matched only on a column that is filled and different on every row in _both_ files, and only when both are profiled in full. Otherwise the comparison says why rows were not matched. Values are compared as trimmed text, so `10` and `10 ` are the same and nothing depends on type decisions.
5. **Compare category values directly.** For category columns with up to 60 values, the values present in only one file are listed. This is the change that most often breaks a report that groups by the column.

## Consequences

- A comparison costs a second profile: roughly as long as profiling the earlier file on its own.
- Files keyed by two columns together (store and day, say) get the structural comparison but not row matching. That can be added later using the pair keys the table checks already find.
- The comparison follows the current file's corrections and region; the earlier file is profiled with the region in force when the comparison was made.
- Everything that is compared is something the profile already measured, so the comparison can't be more confident than the profiles it is built from.
