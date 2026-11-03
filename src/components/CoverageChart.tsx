import { useState } from 'react';
import { formatNumber, type Region } from '../lib/region';
import { fillMonths, formatMonth } from '../lib/table/interpret';
import type { CoverageResult, MonthCount } from '../lib/table/types';

export function CoverageSection({ coverage, region }: { coverage: CoverageResult[]; region: Region }) {
  const charts = coverage.map((c) => ({ ...c, filled: fillMonths(c.months) })).filter((c) => c.filled.length >= 2);
  if (charts.length === 0) return null;
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-white" aria-labelledby="coverage-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-4">
        <h2 id="coverage-heading" className="text-lg font-extrabold">
          Rows per month
        </h2>
        <p className="text-sm text-muted">A month with no rows often means part of an extract is missing.</p>
      </div>
      <div className="flex flex-col divide-y divide-line">
        {charts.map((c) => (
          <CoverageChart key={c.column} column={c.column} months={c.filled} region={region} />
        ))}
      </div>
    </section>
  );
}

function CoverageChart({ column, months, region }: { column: string; months: MonthCount[]; region: Region }) {
  const [active, setActive] = useState<MonthCount | null>(null);
  const peak = Math.max(...months.map((m) => m.rows));
  const empty = months.filter((m) => m.rows === 0).length;
  const rowsText = (n: number) => `${formatNumber(n, region)} ${n === 1 ? 'row' : 'rows'}`;
  const shown = active ?? null;

  return (
    <figure className="flex flex-col gap-3 px-5 py-5" data-testid={`coverage-${column}`}>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-mono text-sm font-bold">{column}</span>
        <span className="text-sm text-ink-soft" aria-live="polite">
          {shown ? (
            <>
              <strong>{formatMonth(shown.month, region)}</strong> · {rowsText(shown.rows)}
            </>
          ) : (
            <>
              {formatMonth(months[0].month, region)} to {formatMonth(months[months.length - 1].month, region)}
              {empty > 0 && (
                <>
                  {' · '}
                  <strong className="text-amber">
                    {empty} {empty === 1 ? 'month' : 'months'} with no rows
                  </strong>
                </>
              )}
            </>
          )}
        </span>
      </figcaption>

      <div className="flex flex-col gap-1" aria-hidden="true">
        <span className="text-xs text-muted">{rowsText(peak)} at most</span>
        <div className="flex h-32 items-end gap-0.5 border-b border-line-strong" onMouseLeave={() => setActive(null)}>
          {months.map((m) => (
            <div
              key={m.month}
              className={`flex h-full min-w-0 flex-1 items-end ${m.rows === 0 ? 'bg-amber-tint' : ''} ${active?.month === m.month ? 'bg-teal-wash' : ''}`}
              onMouseEnter={() => setActive(m)}
            >
              {m.rows > 0 && (
                <div
                  className={`w-full rounded-t ${active?.month === m.month ? 'bg-teal-dark' : 'bg-teal'}`}
                  style={{ height: `${Math.max(2, (m.rows / peak) * 100)}%` }}
                />
              )}
            </div>
          ))}
        </div>
        <div className="flex justify-between text-xs text-muted">
          <span>{formatMonth(months[0].month, region)}</span>
          <span>{formatMonth(months[months.length - 1].month, region)}</span>
        </div>
      </div>

      <details className="text-sm">
        <summary className="flex min-h-11 cursor-pointer items-center font-bold text-teal-dark">
          Show as a table
        </summary>
        <table className="mt-1 w-full max-w-sm border-collapse">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-muted">
              <th scope="col" className="py-1 pr-4 font-bold">
                Month
              </th>
              <th scope="col" className="py-1 text-right font-bold">
                Rows
              </th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month} className="border-t border-line">
                <td className="py-1 pr-4">{formatMonth(m.month, region)}</td>
                <td className={`py-1 text-right font-mono ${m.rows === 0 ? 'font-bold text-amber' : ''}`}>
                  {formatNumber(m.rows, region)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
