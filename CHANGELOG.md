# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-10-26

### Added

- Rule engine that decides each column's type (whole number, decimal, percent, currency, date, text) and role (identifier, measure, category, date, free text, personal data) from evidence in the values.
- Ranked findings panel with plain-English explanations: numbers stored as text, thousands separators, stray non-numbers, leading-zero codes, repeating identifiers, packed fields, placeholder values, ranks in text, impossible dates, two-digit years, mostly-blank and constant columns.
- Date order decided by proof: values with a part above 12 prove day-first or month-first; ISO dates are year-first; columns that can't prove their order borrow it from one in the same file that can; mixed orders are flagged. The region setting only suggests an order when nothing proves it, and makes no suggestion for Canada.
- Personal data detection: email addresses, UK postcodes, UK phone numbers, National Insurance numbers, and NHS numbers validated with the modulus 11 check digit; names and dates of birth from column names.
- Statistics that follow each column's decision: range, mean and median for measures; earliest and latest dates; uniqueness for identifiers.
- Changing the region re-decides the loaded file without reloading it.
- Integration tests that run the evidence SQL on DuckDB-WASM in Node against the golden sample.

### Changed

- Profiling now builds one table of distinct values per column and runs every check once per distinct value, instead of three queries per column. On a 330,000-row test file, all checks take about 4 seconds, against about 11 seconds for the previous, simpler statistics.
- Placeholder values count towards a column's missing figure.
- Raw values and column names are shown in a monospace font, so `|` can't be mistaken for `I`.

## [0.1.0] - 2026-10-21

### Added

- Format detection from the start of a file: encoding (UTF-8, UTF-8 with BOM, UTF-16, Windows-1252), delimiter, header row and line endings.
- Clean-read check that stops on broken rows or unclosed quotes and explains the problem in plain English, with an option to skip broken rows and count them.
- In-browser loading with DuckDB-WASM in a Web Worker, reading every value as text.
- Per-column statistics: blanks, distinct values, value lengths, top values and value shapes.
- Full-file or repeatable 100,000-row sample profiling.
- Region setting (United Kingdom, Canada, United States) for date and number display.
- Strict Content Security Policy on the production build.
- Synthetic golden sample file with known data quality problems, unit tests and browser tests.
