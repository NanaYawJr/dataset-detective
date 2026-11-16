import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormatReport } from '../lib/format/detectFormat';
import { profileFile, redecide } from '../lib/profile/profiler';
import type { ProfileResult, Scope, Step } from '../lib/profile/types';
import type { Region } from '../lib/region';
import type { ColumnOverride, Overrides } from '../lib/rules/types';
import { prepareInWorker } from '../lib/source/prepareInWorker';
import type { PreparedSource } from '../lib/source/types';
import { reportUsage } from '../lib/usage';

export type ProfilerState =
  | { status: 'idle' }
  | { status: 'running'; file: File; step: Step }
  | { status: 'blocked'; file: File; format: FormatReport }
  | { status: 'failed'; file: File; format?: FormatReport; message: string }
  | { status: 'done'; file: File; result: ProfileResult };

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function useProfiler(scope: Scope, region: Region) {
  const [state, setState] = useState<ProfilerState>({ status: 'idle' });
  const [overrides, setOverrides] = useState<Overrides>({});
  // Ignore results from a run the user has since replaced.
  const runId = useRef(0);

  // The prepared form of the file being profiled, kept so a re-run doesn't have to read it again.
  const prepared = useRef<PreparedSource | null>(null);

  const run = useCallback(
    async (file: File, source: PreparedSource, skipBrokenRows: boolean) => {
      const id = ++runId.current;
      const setIfCurrent = (next: ProfilerState) => {
        if (runId.current === id) setState(next);
      };
      try {
        const result = await profileFile(file, source, {
          scope,
          skipBrokenRows,
          region,
          onStep: (step) => setIfCurrent({ status: 'running', file, step }),
        });
        setIfCurrent({ status: 'done', file, result });
        // Anonymous count: a file of this format was profiled. Nothing about the file is sent.
        if (runId.current === id) reportUsage({ type: 'profile', kind: source.details.kind });
      } catch (error) {
        setIfCurrent({ status: 'failed', file, format: source.format, message: errorMessage(error) });
      }
    },
    [scope, region],
  );

  /** Profiles a file. `sheet` picks a worksheet in an Excel workbook. */
  const start = useCallback(
    async (file: File, sheet?: number) => {
      const id = ++runId.current;
      setOverrides({});
      prepared.current = null;
      setState({ status: 'running', file, step: 'read-sample' });
      try {
        const source = await prepareInWorker(file, { sheet });
        if (runId.current !== id) return;
        prepared.current = source;
        setState({ status: 'running', file, step: 'detect-format' });
        if (!source.format.readable) {
          setState({ status: 'blocked', file, format: source.format });
          return;
        }
        await run(file, source, false);
      } catch (error) {
        if (runId.current === id) setState({ status: 'failed', file, message: errorMessage(error) });
      }
    },
    [run],
  );

  const skipBrokenRows = useCallback(
    (file: File) => {
      if (!prepared.current) return;
      setState({ status: 'running', file, step: 'load' });
      void run(file, prepared.current, true);
    },
    [run],
  );

  const reset = useCallback(() => {
    runId.current += 1;
    setOverrides({});
    setState({ status: 'idle' });
  }, []);

  /** Sets or clears the user's correction for one column. */
  const setOverride = useCallback((column: string, override: ColumnOverride | null) => {
    setOverrides((current) => {
      const next = { ...current };
      const merged = { ...next[column], ...override };
      if (override === null) delete next[column];
      else {
        for (const key of Object.keys(merged) as (keyof ColumnOverride)[]) if (!merged[key]) delete merged[key];
        if (Object.keys(merged).length === 0) delete next[column];
        else next[column] = merged;
      }
      return next;
    });
  }, []);

  // When the region or a correction changes after profiling, re-decide the
  // loaded file and re-run the table checks; the old result stays on screen.
  const doneResult = state.status === 'done' ? state.result : null;
  const stale =
    doneResult !== null &&
    (doneResult.region !== region || JSON.stringify(doneResult.overrides) !== JSON.stringify(overrides));
  useEffect(() => {
    if (!doneResult || !stale) return;
    const id = runId.current;
    redecide(doneResult, region, overrides)
      .then((result) => {
        if (runId.current === id) setState((current) => (current.status === 'done' ? { ...current, result } : current));
      })
      .catch(() => undefined);
  }, [doneResult, stale, region, overrides]);

  return { state, start, skipBrokenRows, reset, overrides, setOverride, updating: stale };
}
