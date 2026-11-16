import { prepareSource, type PrepareOptions } from './prepare';
import type { PreparedSource } from './types';

/**
 * Reads the file off the main thread. Unzipping and scanning a large
 * workbook takes seconds; done here, the page stays responsive meanwhile.
 */

export type PrepareRequest = { file: File; options: PrepareOptions };
export type PrepareReply = { ok: true; source: PreparedSource } | { ok: false; message: string };

self.onmessage = (event: MessageEvent<PrepareRequest>) => {
  const reply = (message: PrepareReply) => self.postMessage(message);
  prepareSource(event.data.file, event.data.options).then(
    (source) => reply({ ok: true, source }),
    (error: unknown) => reply({ ok: false, message: error instanceof Error ? error.message : String(error) }),
  );
};
