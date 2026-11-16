import { prepareSource, type PrepareOptions } from './prepare';
import type { PrepareReply, PrepareRequest } from './prepare.worker';
import type { PreparedSource } from './types';

/**
 * Prepares a file in a background worker, so reading a large workbook
 * doesn't freeze the page. Each file gets its own worker, which is shut
 * down afterwards so its memory is released. If a worker can't be started,
 * the file is prepared on the main thread instead.
 */
export function prepareInWorker(file: File, options: PrepareOptions = {}): Promise<PreparedSource> {
  if (typeof Worker === 'undefined') return prepareSource(file, options);

  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./prepare.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      resolve(prepareSource(file, options));
      return;
    }
    worker.onmessage = (event: MessageEvent<PrepareReply>) => {
      worker.terminate();
      if (event.data.ok) resolve(event.data.source);
      else reject(new Error(event.data.message));
    };
    worker.onerror = () => {
      worker.terminate();
      resolve(prepareSource(file, options));
    };
    const request: PrepareRequest = { file, options };
    worker.postMessage(request);
  });
}
