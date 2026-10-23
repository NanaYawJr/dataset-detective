import { useCallback, useRef, useState } from 'react';
import type { FormatReport } from '../lib/format/detectFormat';
import { inspectFile, profileFile } from '../lib/profile/profiler';
import type { ProfileResult, Scope, Step } from '../lib/profile/types';

export type ProfilerState =
  | { status: 'idle' }
  | { status: 'running'; file: File; step: Step }
  | { status: 'blocked'; file: File; format: FormatReport }
  | { status: 'failed'; file: File; format?: FormatReport; message: string }
  | { status: 'done'; result: ProfileResult };

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function useProfiler(scope: Scope) {
  const [state, setState] = useState<ProfilerState>({ status: 'idle' });
  // Ignore results from a run the user has since replaced.
  const runId = useRef(0);

  const run = useCallback(
    async (file: File, format: FormatReport, skipBrokenRows: boolean) => {
      const id = ++runId.current;
      const setIfCurrent = (next: ProfilerState) => {
        if (runId.current === id) setState(next);
      };
      try {
        const result = await profileFile(file, format, {
          scope,
          skipBrokenRows,
          onStep: (step) => setIfCurrent({ status: 'running', file, step }),
        });
        setIfCurrent({ status: 'done', result });
      } catch (error) {
        setIfCurrent({ status: 'failed', file, format, message: errorMessage(error) });
      }
    },
    [scope],
  );

  const start = useCallback(
    async (file: File) => {
      const id = ++runId.current;
      setState({ status: 'running', file, step: 'read-sample' });
      try {
        const format = await inspectFile(file);
        if (runId.current !== id) return;
        setState({ status: 'running', file, step: 'detect-format' });
        if (!format.readable) {
          setState({ status: 'blocked', file, format });
          return;
        }
        await run(file, format, false);
      } catch (error) {
        if (runId.current === id) setState({ status: 'failed', file, message: errorMessage(error) });
      }
    },
    [run],
  );

  const skipBrokenRows = useCallback(
    (file: File, format: FormatReport) => {
      setState({ status: 'running', file, step: 'load' });
      void run(file, format, true);
    },
    [run],
  );

  const reset = useCallback(() => {
    runId.current += 1;
    setState({ status: 'idle' });
  }, []);

  return { state, start, skipBrokenRows, reset };
}
