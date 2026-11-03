import { quoteIdent, quoteLiteral } from '../profile/sql';
import type { ColumnExpr, CoveragePlan, DatePairPlan, TableColumn, TablePlan } from './types';

/**
 * Chooses which whole-table checks are worth running. Checks between pairs
 * of columns grow with the square of the column count, so only plausible
 * candidates are paired, and each list is capped.
 */

const MAX_KEY_COLUMNS = 6;
const MAX_DEPENDENCY_COLUMNS = 10;
const MAX_DEPENDENCY_VALUES = 5000;
const MAX_DATE_COLUMNS = 5;

/** Splits a packed column into its two parts as SQL expressions. */
function packedParts(column: TableColumn): ColumnExpr[] {
  const packed = column.decision.packed;
  if (!packed) return [];
  const c = quoteIdent(column.sqlName);
  const sep = quoteLiteral(packed.separator);
  return packed.parts.map((label, i) => ({
    label,
    within: column.name,
    sql: `nullif(trim(split_part(${c}, ${sep}, ${i + 1})), '')`,
  }));
}

const plain = (column: TableColumn): ColumnExpr => ({ label: column.name, sql: quoteIdent(column.sqlName) });

function pairs<T>(items: T[]): [T, T][] {
  const out: [T, T][] = [];
  for (let i = 0; i < items.length; i += 1)
    for (let j = i + 1; j < items.length; j += 1) out.push([items[i], items[j]]);
  return out;
}

export function planTableChecks(columns: TableColumn[], rows: number): TablePlan {
  const usable = columns.filter((c) => c.decision.role !== 'empty' && c.decision.role !== 'constant');

  // Keys: only search pairs when no single column already identifies every row.
  const singleKey = usable.some((c) => c.facts.filled === rows && c.facts.distinct === rows);
  const keyColumns = singleKey
    ? []
    : usable
        .filter(
          (c) => ['identifier', 'category', 'date', 'personal'].includes(c.decision.role) && c.facts.filled === rows,
        )
        .sort((a, b) => b.facts.distinct - a.facts.distinct)
        .slice(0, MAX_KEY_COLUMNS);

  // Dependencies: low-cardinality columns, plus the two halves of any packed column.
  const lowCardinality = usable
    .filter(
      (c) =>
        ['category', 'identifier', 'personal'].includes(c.decision.role) &&
        c.facts.distinct >= 2 &&
        c.facts.distinct <= MAX_DEPENDENCY_VALUES &&
        c.facts.distinct < rows / 2,
    )
    .sort((a, b) => a.facts.distinct - b.facts.distinct)
    .slice(0, MAX_DEPENDENCY_COLUMNS);
  const dependencyPairs: [ColumnExpr, ColumnExpr][] = [
    ...usable.flatMap((c) => {
      const parts = packedParts(c);
      return parts.length === 2 ? [[parts[0], parts[1]] as [ColumnExpr, ColumnExpr]] : [];
    }),
    ...pairs(lowCardinality.map(plain)),
  ];

  const dateColumns = usable
    .filter((c) => c.decision.type === 'date' && c.decision.date?.order)
    .slice(0, MAX_DATE_COLUMNS)
    .map((c) => ({ label: c.name, sqlName: c.sqlName, order: c.decision.date!.order! }));
  const datePairs: DatePairPlan[] = pairs(dateColumns).map(([a, b]) => ({ a, b }));
  const coverage: CoveragePlan[] = dateColumns;

  return {
    keyPairs: pairs(keyColumns.map(plain)),
    dependencyPairs,
    datePairs,
    coverage,
  };
}
