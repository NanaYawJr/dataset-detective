import { REGIONS, isRegion, type Region } from '../lib/region';
import { Logo } from './Logo';

interface HeaderProps {
  region: Region;
  onRegionChange: (region: Region) => void;
  onHome: () => void;
}

export function Header({ region, onRegionChange, onHome }: HeaderProps) {
  return (
    <header className="border-b border-line bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <button
          type="button"
          onClick={onHome}
          className="flex min-h-11 items-center gap-3 rounded-lg text-left text-ink"
        >
          <span className="text-teal">
            <Logo />
          </span>
          <span className="text-lg font-extrabold tracking-tight">Dataset Detective</span>
        </button>

        <label className="flex items-center gap-2 text-sm font-semibold text-ink-soft">
          Region
          <select
            value={region}
            onChange={(e) => {
              if (isRegion(e.target.value)) onRegionChange(e.target.value);
            }}
            className="min-h-11 rounded-lg border border-line-strong bg-white px-3 text-sm text-ink"
          >
            {REGIONS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label} ({r.example})
              </option>
            ))}
          </select>
        </label>
      </div>
    </header>
  );
}
