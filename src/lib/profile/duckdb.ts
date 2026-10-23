import * as duckdb from '@duckdb/duckdb-wasm';
import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';

/**
 * DuckDB runs in its own Web Worker, so heavy queries never freeze the page.
 * The engine files are bundled with the app and served from the same origin:
 * nothing is fetched from a CDN, and extension downloads are switched off.
 */

const BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
  eh: { mainModule: ehWasm, mainWorker: ehWorker },
};

let instance: Promise<duckdb.AsyncDuckDB> | null = null;

async function start(): Promise<duckdb.AsyncDuckDB> {
  const bundle = await duckdb.selectBundle(BUNDLES);
  const worker = new Worker(bundle.mainWorker!);
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

  const conn = await db.connect();
  try {
    await conn.query('SET autoinstall_known_extensions = false');
    await conn.query('SET autoload_known_extensions = false');
  } finally {
    await conn.close();
  }
  return db;
}

/** Starts DuckDB once and reuses it for every file. */
export function getDuckDb(): Promise<duckdb.AsyncDuckDB> {
  if (!instance) {
    instance = start().catch((error: unknown) => {
      instance = null;
      throw error;
    });
  }
  return instance;
}

export { duckdb };
