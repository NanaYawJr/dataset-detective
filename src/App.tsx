import { useEffect, useState, useSyncExternalStore } from 'react';
import { FeedbackDialog } from './components/FeedbackDialog';
import { Header } from './components/Header';
import { ProgressPanel } from './components/ProgressPanel';
import { ResultsView } from './components/ResultsView';
import { StatsPage } from './components/StatsPage';
import { StopPanel } from './components/StopPanel';
import { UploadPanel } from './components/UploadPanel';
import { useComparison } from './hooks/useComparison';
import { useProfiler } from './hooks/useProfiler';
import type { Scope } from './lib/profile/types';
import { loadRegion, saveRegion, type Region } from './lib/region';
import { reportUsage } from './lib/usage';

/** The private usage page lives at #stats; it isn't linked from anywhere. */
const STATS_HASH = '#stats';
const watchHash = (onChange: () => void) => {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
};
const currentHash = () => window.location.hash;

export default function App() {
  const [region, setRegion] = useState<Region>(loadRegion);
  const [scope, setScope] = useState<Scope>('full');
  const { state, start, skipBrokenRows, reset, setOverride, updating } = useProfiler(scope, region);
  const doneResult = state.status === 'done' ? state.result : null;
  const comparison = useComparison(doneResult, region);

  const showStats = useSyncExternalStore(watchHash, currentHash) === STATS_HASH;
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // One anonymous "the tool was opened" signal per page load. The owner's own stats page doesn't count.
  useEffect(() => {
    if (window.location.hash !== STATS_HASH) reportUsage({ type: 'visit' });
  }, []);

  const changeRegion = (next: Region) => {
    setRegion(next);
    saveRegion(next);
  };

  const goHome = () => {
    if (showStats) window.location.hash = '';
    reset();
  };

  return (
    <div className="min-h-screen">
      <Header region={region} onRegionChange={changeRegion} onHome={goHome} onFeedback={() => setFeedbackOpen(true)} />

      {showStats && <StatsPage region={region} />}

      {!showStats && state.status === 'idle' && (
        <UploadPanel region={region} scope={scope} onScopeChange={setScope} onFile={(file) => void start(file)} />
      )}

      {!showStats && state.status === 'running' && <ProgressPanel file={state.file} step={state.step} />}

      {!showStats && state.status === 'blocked' && (
        <StopPanel
          file={state.file}
          format={state.format}
          onSkipBrokenRows={() => skipBrokenRows(state.file)}
          onChooseAnother={reset}
        />
      )}

      {!showStats && state.status === 'failed' && (
        <StopPanel
          file={state.file}
          format={state.format}
          engineMessage={state.message}
          onSkipBrokenRows={state.format ? () => skipBrokenRows(state.file) : undefined}
          onChooseAnother={reset}
        />
      )}

      {!showStats && state.status === 'done' && (
        <ResultsView
          result={state.result}
          region={region}
          updating={updating}
          onOverride={setOverride}
          onSheet={(sheet) => void start(state.file, sheet)}
          comparison={comparison.state}
          onCompare={(file) => void comparison.compare(state.result, file)}
          onClearComparison={comparison.clear}
          onFeedback={() => setFeedbackOpen(true)}
          onChooseAnother={reset}
        />
      )}

      <FeedbackDialog
        open={feedbackOpen}
        fileKind={doneResult?.source.kind ?? null}
        onClose={() => setFeedbackOpen(false)}
      />

      <footer className="mx-auto max-w-6xl px-4 pb-10 pt-4 text-sm text-muted sm:px-6">
        Dataset Detective gives a snapshot check of one file. It is not ongoing data quality monitoring. Usage is
        counted anonymously, and the rows and values in your files are never sent.{' '}
        <a
          className="font-semibold text-teal-dark underline"
          href="https://github.com/NanaYawJr/dataset-detective/blob/main/PRIVACY.md"
          rel="noreferrer"
        >
          Privacy
        </a>
      </footer>
    </div>
  );
}
