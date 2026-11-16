import { useCallback, useRef, useState } from 'react';
import type { TableComparison } from '../lib/compare/types';
import { explainProblem } from '../lib/format/explain';
import { compareWithEarlier } from '../lib/profile/profiler';
import type { ProfileResult, Step } from '../lib/profile/types';
import type { Region } from '../lib/region';
import { prepareInWorker } from '../lib/source/prepareInWorker';
import { reportUsage } from '../lib/usage';

export type ComparisonState =
  | { status: 'idle' }
  | { status: 'running'; fileName: string; step: Step | 'reading' }
  | { status: 'failed'; fileName: string; title: string; detail: string }
  | { status: 'done'; fileName: string; earlier: ProfileResult; tables: TableComparison };

/** Which profiled file a comparison belongs to. Corrections and region changes keep the same time. */
const keyOf = (result: ProfileResult | null) => result?.profiledAt.getTime() ?? -1;

/**
 * Compares the profiled file with an earlier version of it. The comparison
 * belongs to one profiled file: once a different file is profiled, it no
 * longer applies and reads as not started.
 */
export function useComparison(current: ProfileResult | null, region: Region) {
  const [stored, setStored] = useState<{ key: number; state: ComparisonState }>({ key: -1, state: { status: 'idle' } });
  const runId = useRef(0);
  const state: ComparisonState = stored.key === keyOf(current) ? stored.state : { status: 'idle' };

  const compare = useCallback(
    async (now: ProfileResult, file: File) => {
      const id = ++runId.current;
      const key = keyOf(now);
      const fileName = file.name;
      const set = (next: ComparisonState) => {
        if (runId.current === id) setStored({ key, state: next });
      };
      set({ status: 'running', fileName, step: 'reading' });
      try {
        const source = await prepareInWorker(file);
        if (!source.format.readable) {
          const { title, detail } = explainProblem(source.format.problems[0]);
          set({ status: 'failed', fileName, title, detail });
          return;
        }
        const { earlier, tables } = await compareWithEarlier(now, file, source, {
          region,
          onStep: (step) => set({ status: 'running', fileName, step }),
        });
        set({ status: 'done', fileName, earlier, tables });
        if (runId.current === id) reportUsage({ type: 'profile', kind: source.details.kind });
      } catch (error) {
        set({
          status: 'failed',
          fileName,
          title: "The earlier file couldn't be profiled",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [region],
  );

  const clear = useCallback(() => {
    runId.current += 1;
    setStored({ key: -1, state: { status: 'idle' } });
  }, []);

  return { state, compare, clear };
}
