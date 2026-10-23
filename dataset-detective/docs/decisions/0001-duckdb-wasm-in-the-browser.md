# 0001 · Profile files with DuckDB-WASM in the browser

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

Profiling needs counts, distinct values, grouping and pattern matching over files that may be hundreds of megabytes. The core promise of the product is that files never leave the user's device, so the work has to happen in the browser.

Options considered:

1. **Plain JavaScript** over parsed rows. Simple, but slow and memory-hungry on large files, and every statistic would need hand-written code.
2. **Pyodide** (Python and pandas compiled to WebAssembly). Familiar libraries, but a heavy download, slow start-up and slower on large files.
3. **DuckDB-WASM**, an analytical SQL database compiled to WebAssembly. Fast columnar engine, streams files from disk through the File API, and profiling questions map naturally onto SQL.

## Decision

Use DuckDB-WASM, running in its own Web Worker so the page stays responsive. Bundle the engine with the site instead of loading it from a CDN, and switch off automatic extension downloads.

## Consequences

- Profiling logic is written as SQL plus TypeScript rules. Python profiling libraries can't be reused, but the rules that make this tool useful would need writing either way.
- The engine is large: each WebAssembly build is roughly 35–40 MB uncompressed. Browsers download one build, compressed, once, and then cache it. **Hosting must allow single files of this size**: some static hosts cap files at 25 MB, which rules them out unless the engine is served from elsewhere.
- Excel files are not readable by DuckDB directly and will need a separate reader.
