/**
 * Test helper: the same DuckDB-WASM engine the browser uses, run in Node,
 * so SQL can be tested against real data in ordinary unit tests.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

type Blocking = typeof import('@duckdb/duckdb-wasm/blocking');

const require = createRequire(import.meta.url);
const duckdb = require('@duckdb/duckdb-wasm/blocking') as Blocking;

const dist = fileURLToPath(new URL('../../../node_modules/@duckdb/duckdb-wasm/dist/', import.meta.url));

export type Row = Record<string, unknown>;

export interface TestDb {
  /** Registers text as a file DuckDB can read by name. */
  addFile(name: string, text: string): void;
  run(sql: string): void;
  rows(sql: string): Row[];
}

export async function openTestDb(): Promise<TestDb> {
  const db = await duckdb.createDuckDB(
    {
      mvp: { mainModule: `${dist}duckdb-mvp.wasm`, mainWorker: `${dist}duckdb-node-mvp.worker.cjs` },
      eh: { mainModule: `${dist}duckdb-eh.wasm`, mainWorker: `${dist}duckdb-node-eh.worker.cjs` },
    },
    new duckdb.VoidLogger(),
    duckdb.NODE_RUNTIME,
  );
  await db.instantiate();
  const conn = db.connect();
  return {
    addFile: (name, text) => db.registerFileText(name, text),
    run: (sql) => {
      conn.query(sql);
    },
    rows: (sql) =>
      conn
        .query(sql)
        .toArray()
        .map((row) => row.toJSON() as Row),
  };
}
