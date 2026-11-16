# 0010 · One fix plan, written out in three languages

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

A profile says what is wrong with a file. The next question is always "how do I fix it?", and the answer depends on where the reader works: Power BI or Excel (Power Query), SQL Server (T-SQL) or Python (pandas). Writing three separate generators from the findings would let them drift apart: one would learn to split a packed column and the others would not.

Generated code also carries a risk a report does not: someone will run it. Code that silently turns `03/04/2026` into the wrong date is worse than no code.

## Decision

1. **Plan first, in no language.** `buildFixPlan` turns the column decisions into a list of steps: drop an empty column, blank out placeholders, convert to a number (removing `%`, currency symbols or thousands separators), read as a date in a stated order, split a packed column, add a rank number. The three writers only choose syntax, so they cannot disagree about what to do.
2. **The plan follows the evidence, including its doubts.** A date column is converted only when its order was proven, borrowed from a proven column, or chosen by the user. Otherwise it is left as text and the reason is shown. Codes with leading zeros are never made numbers.
3. **Conversions fail to blank.** Every writer uses the safe form: `TRY_CONVERT` in T-SQL, `try … otherwise null` in M, `errors="coerce"` in pandas. A value that does not fit becomes blank and can be counted, instead of stopping the script or becoming something else.
4. **The reading step fits the file.** Delimiter and encoding for text; sheet name and header row for Excel; typed columns for Parquet; the record list and nested fields for JSON. The helper functions accept values that are already typed, so the same steps work whether a column arrives as text or as a date.
5. **T-SQL starts from a staging table.** A query cannot read a file by itself in a portable way, so the script assumes the file has been loaded as text into a staging table, says how, and builds a typed table from it.

## How far it is tested

- **pandas:** the script generated for each sample (CSV, Excel, Parquet) is executed, on pandas 2 and 3, and the cleaned data is checked against known answers.
- **T-SQL:** the generated script is parsed as SQL Server syntax during development, and its structure is asserted in tests. It is not executed: no SQL Server is available to the tests.
- **Power Query:** the structure is asserted in tests (every step feeds the next, brackets balance). It is not executed: M only runs inside Power BI or Excel.

The panel tells the reader to read the script before running it.

## Consequences

- A new kind of fix is added once, to the plan, and then to each writer; a test on the plan covers all three.
- The scripts are deliberately plain and commented, so they can be read and edited, and they work on a copy: none of them changes the original file.
- Duplicate or blank column names are renamed differently by each tool, so a script for such a file may need its column names adjusted by hand.
