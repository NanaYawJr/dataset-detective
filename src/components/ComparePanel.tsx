import { useMemo, useRef, type ReactNode } from 'react';
import { compareProfiles, rowsDroppedSeriously } from '../lib/compare/compare';
import type { Comparison, RowDiff } from '../lib/compare/types';
import { STEP_LABELS, type ProfileResult } from '../lib/profile/types';
import { formatNumber, type Region } from '../lib/region';
import type { ComparisonState } from '../hooks/useComparison';
import { BADGE } from './severity';

const ACCEPT = '.csv,.tsv,.txt,.xlsx,.xlsm,.parquet,.json,.jsonl,.ndjson';

interface ComparePanelProps {
  result: ProfileResult;
  region: Region;
  state: ComparisonState;
  onCompare: (file: File) => void;
  onClear: () => void;
}

/** Compares the profiled file with an earlier version of it: last month's extract, say. */
export function ComparePanel({ result, region, state, onCompare, onClear }: ComparePanelProps) {
  const input = useRef<HTMLInputElement>(null);
  const choose = () => input.current?.click();

  const comparison = useMemo(
    () => (state.status === 'done' ? compareProfiles(result, state.earlier, state.tables.values, region) : null),
    [result, state, region],
  );

  const button = (label: string, primary = false) => (
    <button
      type="button"
      onClick={choose}
      className={`min-h-11 rounded-xl px-5 text-sm font-bold ${
        primary
          ? 'bg-teal text-white hover:bg-teal-dark'
          : 'border border-line-strong bg-white text-ink hover:bg-surface'
      }`}
    >
      {label}
    </button>
  );

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-white" aria-labelledby="compare-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-4">
        <h2 id="compare-heading" className="text-lg font-extrabold">
          Compare with an earlier version
        </h2>
        <p className="text-sm text-muted">What changed since the last delivery of this file.</p>
      </div>

      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-label="Earlier version of the file"
        data-testid="compare-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onCompare(file);
        }}
      />

      <div className="flex flex-col gap-5 px-5 py-5">
        {state.status === 'idle' && (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="max-w-2xl text-sm leading-relaxed text-ink-soft">
              Choose an earlier copy of this file, such as last month's extract. It is profiled the same way, in your
              browser, and compared with this one: columns added or removed, types that changed, new missing values and
              category values, and, when the file has a key, which rows were added, removed or edited.
            </p>
            {button('Choose the earlier file', true)}
          </div>
        )}

        {state.status === 'running' && (
          <p className="text-sm font-semibold text-ink-soft" role="status">
            Profiling <span className="font-mono">{state.fileName}</span>:{' '}
            {state.step === 'reading' ? 'reading the file' : STEP_LABELS[state.step].toLowerCase()}…
          </p>
        )}

        {state.status === 'failed' && (
          <>
            <div role="alert" className="rounded-xl border border-[#e9b8b2] bg-red-tint px-4 py-3 text-sm">
              <strong className="text-red">{state.title}.</strong> <span className="text-ink-soft">{state.detail}</span>
            </div>
            <div>{button('Choose another file')}</div>
          </>
        )}

        {state.status === 'done' && comparison && (
          <>
            <Result
              comparison={comparison}
              rows={state.tables.rows}
              noRowsReason={state.tables.noRowsReason}
              earlierName={state.fileName}
              currentName={result.fileName}
              region={region}
            />
            <div className="flex flex-wrap gap-3">
              {button('Compare with a different file')}
              <button
                type="button"
                onClick={onClear}
                className="min-h-11 rounded-xl px-5 text-sm font-bold text-ink-soft hover:text-ink"
              >
                Stop comparing
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

interface ResultProps {
  comparison: Comparison;
  rows: RowDiff | null;
  noRowsReason: string | null;
  earlierName: string;
  currentName: string;
  region: Region;
}

function Result({ comparison, rows, noRowsReason, earlierName, currentName, region }: ResultProps) {
  const n = (value: number) => formatNumber(value, region);
  const { added, removed, renamed, reordered, columns, findings } = comparison;
  const structureChanged = added.length + removed.length + renamed.length > 0 || reordered;
  const dropped = rowsDroppedSeriously(comparison.rows);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p className="text-lg font-extrabold" data-testid="compare-headline">
          {comparison.headline}
        </p>
        <p className="break-words text-sm text-muted">
          <span className="font-mono">{earlierName}</span> (earlier) compared with{' '}
          <span className="font-mono">{currentName}</span>
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label="Rows" value={`${n(comparison.rows.earlier)} → ${n(comparison.rows.current)}`} warn={dropped}>
          {dropped ? 'A large drop: check the extract is complete' : 'Earlier → now'}
        </Tile>
        {rows ? (
          <>
            <Tile
              label="Rows added / removed"
              value={`+${n(rows.added)} / −${n(rows.removed)}`}
              testId="rows-added-removed"
            >
              Matched on {rows.key}
            </Tile>
            <Tile label="Rows edited" value={n(rows.changed)} testId="rows-changed">
              {rows.kept > 0 ? `Of ${n(rows.kept)} rows in both files` : 'No rows in both files'}
            </Tile>
          </>
        ) : (
          <div
            className="self-start rounded-2xl border border-line bg-surface px-5 py-4 text-sm text-ink-soft sm:col-span-2"
            data-testid="no-row-match"
          >
            {noRowsReason}
          </div>
        )}
      </div>

      {rows && rows.added + rows.removed + rows.changed > 0 && (
        <Block title="Rows">
          <ul className="flex flex-col gap-2 text-sm leading-relaxed text-ink-soft" data-testid="row-examples">
            {rows.examples.added.length > 0 && (
              <li>
                <strong className="text-ink">New:</strong>{' '}
                <Keys keys={rows.examples.added} total={rows.added} region={region} />
              </li>
            )}
            {rows.examples.removed.length > 0 && (
              <li>
                <strong className="text-ink">Gone:</strong>{' '}
                <Keys keys={rows.examples.removed} total={rows.removed} region={region} />
              </li>
            )}
            {rows.byColumn.length > 0 && (
              <li>
                <strong className="text-ink">Edited:</strong>{' '}
                {rows.byColumn.map((c, i) => (
                  <span key={c.column}>
                    {i > 0 && ', '}
                    <span className="font-mono font-semibold">{c.column}</span> in {n(c.rows)}{' '}
                    {c.rows === 1 ? 'row' : 'rows'}
                  </span>
                ))}
                {rows.examples.changed.length > 0 && (
                  <>
                    {'. For example '}
                    {rows.examples.changed.slice(0, 3).map((e, i) => (
                      <span key={e.key}>
                        {i > 0 && '; '}
                        <span className="font-mono">{e.key}</span> ({e.columns.join(', ')})
                      </span>
                    ))}
                    .
                  </>
                )}
              </li>
            )}
          </ul>
        </Block>
      )}

      {structureChanged && (
        <Block title="Columns">
          <ul className="flex flex-col gap-2 text-sm leading-relaxed text-ink-soft" data-testid="structure-changes">
            {added.length > 0 && (
              <li>
                <strong className="text-ink">New:</strong> <Names names={added} />
              </li>
            )}
            {removed.length > 0 && (
              <li>
                <strong className="text-ink">Gone:</strong> <Names names={removed} />. Anything that uses{' '}
                {removed.length === 1 ? 'it' : 'them'} will break.
              </li>
            )}
            {renamed.map(({ from, to }) => (
              <li key={to}>
                <strong className="text-ink">Renamed:</strong> <span className="font-mono">{from}</span> is now{' '}
                <span className="font-mono">{to}</span>.
              </li>
            ))}
            {reordered && (
              <li>
                <strong className="text-ink">Reordered:</strong> the columns are in a different order. Anything that
                reads them by position, not by name, will pick up the wrong column.
              </li>
            )}
          </ul>
        </Block>
      )}

      {columns.length > 0 && (
        <Block title="Inside the columns">
          <ul className="divide-y divide-line rounded-xl border border-line" data-testid="column-changes">
            {columns.map((column) => (
              <li key={column.name} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:gap-4">
                <span className="font-mono text-sm font-bold sm:w-48 sm:shrink-0 sm:break-words">{column.name}</span>
                <ul className="flex flex-col gap-1.5">
                  {column.changes.map((change) => (
                    <li key={change.text} className="flex items-start gap-2 text-sm leading-relaxed">
                      <span
                        className={`mt-0.5 shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold ${BADGE[change.severity].className}`}
                      >
                        {BADGE[change.severity].label}
                      </span>
                      <span className="text-ink-soft">{change.text}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {findings.fresh.length + findings.resolved.length > 0 && (
        <Block title="Problems">
          <div className="grid gap-4 sm:grid-cols-2">
            <FindingList title="New since the earlier file" items={findings.fresh} empty="None" testId="findings-new" />
            <FindingList
              title="Gone since the earlier file"
              items={findings.resolved}
              empty="None"
              testId="findings-resolved"
            />
          </div>
        </Block>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  warn,
  testId,
  children,
}: {
  label: string;
  value: string;
  warn?: boolean;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex min-w-0 flex-col gap-1 rounded-2xl border px-5 py-4 ${warn ? 'border-amber bg-amber-tint' : 'border-line bg-white'}`}
    >
      <span className="text-sm font-semibold text-muted">{label}</span>
      <span className="break-words text-2xl font-extrabold" data-testid={testId}>
        {value}
      </span>
      <span className={`text-sm ${warn ? 'font-semibold text-amber' : 'text-muted'}`}>{children}</span>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-bold">{title}</h3>
      {children}
    </div>
  );
}

function Names({ names }: { names: string[] }) {
  return (
    <>
      {names.map((name, i) => (
        <span key={name}>
          {i > 0 && ', '}
          <span className="font-mono font-semibold">{name}</span>
        </span>
      ))}
    </>
  );
}

function Keys({ keys, total, region }: { keys: string[]; total: number; region: Region }) {
  const more = total - keys.length;
  return (
    <>
      {formatNumber(total, region)} {total === 1 ? 'row' : 'rows'}, such as{' '}
      {keys.map((key, i) => (
        <span key={key}>
          {i > 0 && ', '}
          <span className="font-mono">{key}</span>
        </span>
      ))}
      {more > 0 ? '…' : ''}
    </>
  );
}

function FindingList({
  title,
  items,
  empty,
  testId,
}: {
  title: string;
  items: Comparison['findings']['fresh'];
  empty: string;
  testId: string;
}) {
  return (
    <div className="rounded-xl border border-line px-4 py-3">
      <p className="text-xs font-bold uppercase tracking-wider text-muted">{title}</p>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-ink-soft">{empty}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5 text-sm" data-testid={testId}>
          {items.map((item) => (
            <li key={`${item.column}-${item.title}`} className="leading-relaxed text-ink-soft">
              <span className="font-mono font-semibold text-ink">{item.column}</span>: {item.title}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
