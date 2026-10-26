import { describeDateOrder, formatDateKey, formatMeasure, roleLabel, typeLabel } from '../lib/display';
import type { ColumnStats, ValueCount } from '../lib/profile/types';
import { formatNumber, formatPercent, type Region } from '../lib/region';

interface ColumnTableProps {
  columns: ColumnStats[];
  rows: number;
  region: Region;
}

export function ColumnTable({ columns, rows, region }: ColumnTableProps) {
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-4">
        <h2 className="text-lg font-extrabold">Columns</h2>
        <p className="text-sm text-muted">Types are decided from the values themselves, not guessed by the reader.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-muted">
              <th scope="col" className="px-5 py-3 font-bold">
                Column
              </th>
              <th scope="col" className="px-3 py-3 font-bold">
                Missing
              </th>
              <th scope="col" className="px-3 py-3 font-bold">
                Distinct
              </th>
              <th scope="col" className="px-3 py-3 font-bold">
                Summary
              </th>
              <th scope="col" className="px-3 py-3 font-bold">
                Top values
              </th>
              <th scope="col" className="px-5 py-3 font-bold">
                Value shapes
              </th>
            </tr>
          </thead>
          <tbody>
            {columns.map((column) => (
              <ColumnRow key={column.sqlName} column={column} rows={rows} region={region} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ColumnRow({ column, rows, region }: { column: ColumnStats; rows: number; region: Region }) {
  const { decision } = column;
  const missing = decision.effectivelyMissing;
  const missingShare = rows === 0 ? 0 : missing / rows;
  const flagged = decision.findings.filter((f) => f.severity !== 'info').length;

  return (
    <tr className="border-t border-line align-top" data-testid={`column-${column.name}`}>
      <th scope="row" className="min-w-48 px-5 py-4 text-left font-normal">
        <span className="block font-mono text-sm font-bold text-ink" title={column.name}>
          {column.name}
        </span>
        <span className="mt-1.5 flex flex-wrap gap-1 whitespace-nowrap text-xs font-semibold">
          <span className="rounded-md bg-surface px-1.5 py-0.5 text-ink-soft">{typeLabel(decision.type)}</span>
          <span className="rounded-md bg-teal-tint px-1.5 py-0.5 text-teal-dark">{roleLabel(decision.role)}</span>
          {flagged > 0 && (
            <span className="rounded-md bg-amber-tint px-1.5 py-0.5 text-amber">
              {flagged} {flagged === 1 ? 'finding' : 'findings'}
            </span>
          )}
        </span>
      </th>
      <td className="whitespace-nowrap px-3 py-4">
        <span className={missingShare > 0 ? 'font-bold text-amber' : 'text-ink-soft'}>
          {formatPercent(missingShare, region)}
        </span>
        <span className="block text-xs text-muted">{formatNumber(column.empty, region)} blank</span>
        {column.facts.placeholders > 0 && (
          <span className="block text-xs text-muted">
            {formatNumber(column.facts.placeholders, region)} placeholder
          </span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-4">
        {formatNumber(column.distinct, region)}
        {column.distinct === column.filled && column.filled > 0 && (
          <span className="block text-xs font-semibold text-teal-dark">all unique</span>
        )}
      </td>
      <td className="px-3 py-4">
        <Summary column={column} region={region} />
      </td>
      <td className="px-3 py-4">
        <ValueList values={column.topValues} total={column.filled} region={region} />
      </td>
      <td className="px-5 py-4">
        <ValueList values={column.shapes} total={column.filled} region={region} />
      </td>
    </tr>
  );
}

/** The statistics that make sense for this kind of column, and nothing misleading. */
function Summary({ column, region }: { column: ColumnStats; region: Region }) {
  const { decision, measure, dateRange } = column;

  if (measure) {
    const f = (v: number) => formatMeasure(v, decision.type, region);
    return (
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 whitespace-nowrap text-xs">
        <dt className="text-muted">Range</dt>
        <dd className="font-mono">
          {f(measure.min)} – {f(measure.max)}
        </dd>
        <dt className="text-muted">Mean</dt>
        <dd className="font-mono">{f(measure.mean)}</dd>
        <dt className="text-muted">Median</dt>
        <dd className="font-mono">{f(measure.median)}</dd>
      </dl>
    );
  }

  if (decision.type === 'date' && decision.date) {
    return (
      <div className="flex flex-col gap-0.5 whitespace-nowrap text-xs">
        {dateRange && (
          <span className="font-mono">
            {formatDateKey(dateRange.first, region)} – {formatDateKey(dateRange.last, region)}
          </span>
        )}
        <span className="text-muted">{describeDateOrder(decision.date, region)}</span>
      </div>
    );
  }

  if (decision.role === 'identifier') {
    const repeats = column.filled - column.distinct;
    return repeats === 0 ? (
      <span className="text-xs font-semibold text-teal-dark">Unique in every row</span>
    ) : (
      <span className="text-xs font-semibold text-amber">Repeats in {formatNumber(repeats, region)} rows</span>
    );
  }

  if (column.minLength === null) return <span className="text-muted">—</span>;
  const length =
    column.minLength === column.maxLength ? `${column.minLength}` : `${column.minLength}–${column.maxLength}`;
  return <span className="whitespace-nowrap text-xs text-muted">Length {length}</span>;
}

/**
 * Raw values are shown in a monospace font so every character is
 * unambiguous: a pipe never looks like a capital I, and 0 never looks like O.
 */
function ValueList({ values, total, region }: { values: ValueCount[]; total: number; region: Region }) {
  if (values.length === 0) return <span className="text-muted">—</span>;
  return (
    <ul className="flex flex-col gap-1">
      {values.map((v) => (
        <li key={v.value} className="flex items-baseline justify-between gap-3">
          <span className="max-w-40 truncate font-mono text-xs" title={v.value}>
            {v.value}
          </span>
          <span className="shrink-0 text-xs text-muted">
            {formatNumber(v.count, region)}
            {total > 0 && ` · ${formatPercent(v.count / total, region)}`}
          </span>
        </li>
      ))}
    </ul>
  );
}
