# 0008 · Read every format in the browser, through one path

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

Version 0.4 adds Excel, Parquet and JSON. Three things constrain how:

1. **The privacy promise.** The page's security policy only lets it fetch its own files. In the DuckDB-WASM version in use, the Parquet, JSON and Excel readers are extensions that the engine downloads from DuckDB's servers the first time they are needed. That download is exactly what the policy forbids, and extension loading is switched off.
2. **The rule engine reads text.** Every check is written against values as text, with types decided from evidence ([decision 0002](0002-read-every-value-as-text.md)). A second path for typed data would mean every rule, and every test, twice.
3. **Dependencies are part of the attack surface.** The most widely used spreadsheet library's last release on the npm registry has published security advisories against it, and newer versions are distributed outside the registry.

## Decision

Read each format with code that ships with the page, and turn it into CSV text in memory. From there, every format goes through exactly the same loader, evidence queries, rules and table checks as a CSV file.

- **Excel:** a purpose-built reader. An `.xlsx` file is a zip of XML; it is unzipped with [fflate](https://github.com/101arrowz/fflate) and scanned once by a small scanner (about 100 lines) that never builds a tree, so a large sheet doesn't need several times its size in memory. Only what a profiler needs is read: sheet names and visibility, shared text, number formats (to recognise dates), cells and merged ranges. Styles, charts, macros and formulas are ignored; a formula's stored result is used.
- **Parquet:** [hyparquet](https://github.com/hyparam/hyparquet), a dependency-free reader, with its companion decompressors. Both are loaded only when a Parquet file is opened.
- **JSON:** the browser's own parser, plus rules for finding the list of records and flattening nested objects.
- **A Web Worker** does the reading, so unzipping and scanning a large workbook doesn't freeze the page.

Two things are converted on the way to text, because the stored form would mislead: Excel dates (stored as day counts, such as 45685) and Parquet dates and timestamps are written as ISO dates. Everything else is read as stored, not as displayed.

## Consequences

- Every existing check works on every format with no new rules. The tests prove it: the Excel and Parquet samples must produce the same column decisions as the CSV sample.
- Typed data takes a detour through text. For Parquet this costs time and memory, and it is deliberate: the declared type is reported, and the evidence decides. A column declared as text that holds dates is a finding, and it could not be found by trusting the declaration.
- Because Excel dates arrive as real dates, there is no day/month order to get wrong. That is a point in Excel's favour over CSV, and the report says so.
- The whole file is held in memory while it is converted, so very large Parquet files (many millions of rows) are slower than they would be with a native reader. A 200,000-row workbook takes about 15 seconds end to end, and the page stays responsive throughout.
- Not supported, and explained when met: `.xls`, `.xlsb`, and password-protected workbooks.
- The Excel reader is tested against workbooks written by openpyxl and XlsxWriter, and the Parquet reader against files written by pyarrow and DuckDB, because a reader tested only against its own project's writer proves little.
