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
        <p className="text-sm text-muted">
          Every value is read as text first. Deciding real types comes in the next step.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-muted">
              <th scope="col" className="px-5 py-3 font-bold">
                Column
              </th>
              <th scope="col" className="px-3 py-3 font-bold">
                Blank
              </th>
              <th scope="col" className="px-3 py-3 font-bold">
                Distinct
              </th>
              <th scope="col" className="px-3 py-3 font-bold">
                Length
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
            {columns.map((column) => {
              const blankShare = rows === 0 ? 0 : column.empty / rows;
              return (
                <tr key={column.name} className="border-t border-line align-top">
                  <th scope="row" className="px-5 py-4 text-left font-bold">
                    {column.name}
                  </th>
                  <td className="px-3 py-4 whitespace-nowrap">
                    <span className={blankShare > 0 ? 'font-bold text-amber' : 'text-ink-soft'}>
                      {formatPercent(blankShare, region)}
                    </span>
                    <span className="block text-xs text-muted">{formatNumber(column.empty, region)} rows</span>
                  </td>
                  <td className="px-3 py-4 whitespace-nowrap">
                    {formatNumber(column.distinct, region)}
                    {column.distinct === column.filled && column.filled > 0 && (
                      <span className="block text-xs font-semibold text-teal-dark">all unique</span>
                    )}
                  </td>
                  <td className="px-3 py-4 whitespace-nowrap text-ink-soft">
                    {column.minLength === null
                      ? '—'
                      : column.minLength === column.maxLength
                        ? `${column.minLength}`
                        : `${column.minLength}–${column.maxLength}`}
                  </td>
                  <td className="px-3 py-4">
                    <ValueList values={column.topValues} total={column.filled} region={region} />
                  </td>
                  <td className="px-5 py-4">
                    <ValueList values={column.shapes} total={column.filled} region={region} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
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
          <span className="max-w-56 truncate font-mono text-xs" title={v.value}>
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
