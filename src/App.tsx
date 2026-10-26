import { useState } from 'react';
import { Header } from './components/Header';
import { ProgressPanel } from './components/ProgressPanel';
import { ResultsView } from './components/ResultsView';
import { StopPanel } from './components/StopPanel';
import { UploadPanel } from './components/UploadPanel';
import { useProfiler } from './hooks/useProfiler';
import type { Scope } from './lib/profile/types';
import { loadRegion, saveRegion, type Region } from './lib/region';

export default function App() {
  const [region, setRegion] = useState<Region>(loadRegion);
  const [scope, setScope] = useState<Scope>('full');
  const { state, start, skipBrokenRows, reset } = useProfiler(scope, region);

  const changeRegion = (next: Region) => {
    setRegion(next);
    saveRegion(next);
  };

  return (
    <div className="min-h-screen">
      <Header region={region} onRegionChange={changeRegion} onHome={reset} />

      {state.status === 'idle' && (
        <UploadPanel region={region} scope={scope} onScopeChange={setScope} onFile={(file) => void start(file)} />
      )}

      {state.status === 'running' && <ProgressPanel file={state.file} step={state.step} />}

      {state.status === 'blocked' && (
        <StopPanel
          file={state.file}
          format={state.format}
          onSkipBrokenRows={() => skipBrokenRows(state.file, state.format)}
          onChooseAnother={reset}
        />
      )}

      {state.status === 'failed' && (
        <StopPanel
          file={state.file}
          format={state.format}
          engineMessage={state.message}
          onSkipBrokenRows={state.format ? () => skipBrokenRows(state.file, state.format!) : undefined}
          onChooseAnother={reset}
        />
      )}

      {state.status === 'done' && <ResultsView result={state.result} region={region} onChooseAnother={reset} />}

      <footer className="mx-auto max-w-6xl px-4 pb-10 pt-4 text-sm text-muted sm:px-6">
        Dataset Detective gives a snapshot check of one file. It is not ongoing data quality monitoring.
      </footer>
    </div>
  );
}
