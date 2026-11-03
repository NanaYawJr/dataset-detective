# 0006 · Plan the whole-table checks, and parse each value once

- **Status:** Accepted
- **Date:** 2026-11-03

## Context

Checks across columns grow with the square of the column count. A 30-column file has 435 pairs of columns, and each pair can be tested as a key, as a dependency in two directions, or as an order of events. Running every test on every pair would be slow on a large file and would also produce noise: "each Notes value has exactly one Amount" is true of any column whose values never repeat, and says nothing.

A first version on a 330,000-row, 15-column test file took **35 seconds** for the table checks alone. Most of that was dependencies (each direction scanned the table twice) and dates (the date parser, which uses regular expressions, ran on every row of every date column).

## Decision

1. **Plan before querying.** The column decisions choose the candidates:
   - two-column keys are only searched for when no single column identifies every row, among at most 6 filled columns;
   - dependencies are tested between at most 10 columns with 2–5,000 distinct values and fewer distinct values than half the rows, plus the two parts of each packed column;
   - date checks use at most 5 date columns whose order is decided.
2. **Group each pair once.** A dependency query groups the table by the pair of values, then reads both directions ("A has one B" and "B has one A") from that small result.
3. **Parse each distinct date once.** Rows per month group a date column by its raw value first, then parse; the order of events groups by the pair of raw values first.
4. **Judge rules only on values that repeat.** A value seen in one row trivially "has one" of anything. A dependency is only reported when at least half of its values repeat, and a broken rule is only flagged when 5% or fewer of the repeating values break it — otherwise it is simply not a rule.

## Consequences

- On the same 330,000-row file the table checks take about **7 seconds**, of which dates take under half a second.
- Some real dependencies between high-cardinality columns (for example, Product Code → Product Name with 50,000 products) are not tested. That is a deliberate trade for speed and can be revisited with sampling.
- The planner is pure TypeScript and the interpretation has no SQL in it, so both are unit-tested without a database; the SQL is tested against the real engine on the golden sample.
