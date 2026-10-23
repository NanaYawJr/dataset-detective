# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
