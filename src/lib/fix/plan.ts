import type { Delimiter, Encoding } from '../format/detectFormat';
import type { ColumnDecision, ColumnFacts, DecidedDateOrder } from '../rules/types';
import type { SourceKind } from '../source/types';

/**
 * Works out what has to be done to a file to make it usable, from what the
 * profile found. The plan is the same whatever language it is written in;
 * the writers (powerQuery.ts, tsql.ts, pandas.ts) only choose the syntax.
 */

export type TargetType = 'text' | 'whole number' | 'decimal' | 'date' | 'date and time';

export type ColumnStep =
  /** Values such as "N/A" that stand for "missing" become real blanks. */
  | { kind: 'null-placeholders'; values: string[] }
  /** Text such as "5%" or "£1,200" becomes a number. `percent` divides by 100. */
  | { kind: 'number'; remove: string[]; percent: boolean; whole: boolean }
  | { kind: 'date'; order: DecidedDateOrder; withTime: boolean }
  /** One column holding two fields becomes two columns. */
  | { kind: 'split'; separator: string; parts: [string, string] }
  /** "1-Urgent" keeps its text and gains a number column to sort by. */
  | { kind: 'rank'; newColumn: string }
  | { kind: 'drop' };

export interface ColumnPlan {
  name: string;
  target: TargetType;
  steps: ColumnStep[];
}

export interface PlanSource {
  kind: SourceKind;
  fileName: string;
  delimiter: Delimiter;
  encoding: Encoding;
  hasHeader: boolean;
  /** Excel: the sheet that was profiled, and the row its header is on (1-based). */
  sheetName?: string;
  headerRow?: number;
  /** JSON: where the list of records sits, when it is not the whole file. */
  listPath?: string;
  /** JSON: one record per line. */
  jsonLines?: boolean;
}

export interface FixPlan {
  source: PlanSource;
  columns: ColumnPlan[];
  removeDuplicateRows: boolean;
  /** What the script does, in plain words, in the order it does it. */
  summary: string[];
  /** Things the script deliberately leaves alone, and why. */
  leftAlone: string[];
}

export interface PlanColumn {
  name: string;
  facts: ColumnFacts;
  decision: ColumnDecision;
  /** Value shapes such as "9999-99-99 99:99:99", used to see whether dates carry a time. */
  shapes?: { value: string }[];
}

const CURRENCY_SYMBOLS = ['£', '$', '€'];
const list = (names: string[]) =>
  names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;

function planColumn(column: PlanColumn, leftAlone: string[]): ColumnPlan {
  const { name, facts, decision } = column;
  const steps: ColumnStep[] = [];
  let target: TargetType = 'text';

  if (decision.role === 'empty') return { name, target, steps: [{ kind: 'drop' }] };

  if (facts.placeholderValues.length > 0) {
    steps.push({ kind: 'null-placeholders', values: facts.placeholderValues });
  }

  const numeric = ['integer', 'decimal', 'percent', 'currency'].includes(decision.type);
  if (numeric && facts.leadingZeros > 0) {
    leftAlone.push(`${name} stays as text: its values start with zeros (such as 00123), which a number would lose.`);
  } else if (numeric) {
    const remove = [
      ...(decision.type === 'percent' ? ['%'] : []),
      ...(decision.type === 'currency' ? CURRENCY_SYMBOLS : []),
      ...(facts.thousands > 0 || decision.type === 'currency' ? [','] : []),
    ];
    const whole = decision.type === 'integer';
    steps.push({ kind: 'number', remove, percent: decision.type === 'percent', whole });
    target = whole ? 'whole number' : 'decimal';
  } else if (decision.type === 'date') {
    const order = decision.date?.order;
    if (order) {
      const withTime = (column.shapes ?? []).some((shape) => /99:99/.test(shape.value));
      steps.push({ kind: 'date', order, withTime });
      target = withTime ? 'date and time' : 'date';
    } else {
      leftAlone.push(
        `${name} stays as text: nothing in the file proves whether its dates are day-first or month-first. Choose the order with "Correct this" and the script will convert it.`,
      );
    }
  }

  if (decision.packed) {
    steps.push({ kind: 'split', separator: decision.packed.separator, parts: decision.packed.parts });
  }
  if (decision.findings.some((finding) => finding.kind === 'rank-in-text')) {
    steps.push({ kind: 'rank', newColumn: `${name} Rank` });
  }
  return { name, target, steps };
}

export function buildFixPlan(source: PlanSource, columns: PlanColumn[], duplicateRows: number): FixPlan {
  const leftAlone: string[] = [];
  const plans = columns.map((column) => planColumn(column, leftAlone));
  const draft: FixPlan = { source, columns: plans, removeDuplicateRows: duplicateRows > 0, summary: [], leftAlone };
  const withStep = <K extends ColumnStep['kind']>(kind: K) => stepsOf(draft, kind);

  const summary: string[] = ['Read the file with every column as text, so nothing is converted by guesswork.'];
  const dropped = withStep('drop');
  if (dropped.length > 0)
    summary.push(
      `Remove ${dropped.length === 1 ? 'the empty column' : 'empty columns'}: ${list(dropped.map((d) => d.name))}.`,
    );
  const placeholders = withStep('null-placeholders');
  if (placeholders.length > 0) {
    summary.push(`Turn placeholder values into real blanks in ${list(placeholders.map((p) => p.name))}.`);
  }
  const numbers = withStep('number');
  const percents = numbers.filter((n) => n.step.percent);
  if (percents.length > 0)
    summary.push(
      `Convert percentages stored as text to numbers in ${list(percents.map((p) => p.name))}: "5%" becomes 0.05.`,
    );
  const symbols = numbers.filter((n) => !n.step.percent && n.step.remove.length > 0);
  if (symbols.length > 0)
    summary.push(
      `Remove currency symbols and thousands separators and convert to numbers in ${list(symbols.map((p) => p.name))}.`,
    );
  const plain = numbers.filter((n) => !n.step.percent && n.step.remove.length === 0);
  if (plain.length > 0) summary.push(`Set number types for ${list(plain.map((p) => p.name))}.`);
  for (const order of ['day-first', 'month-first', 'year-first'] as const) {
    const dates = withStep('date').filter((d) => d.step.order === order);
    if (dates.length > 0) summary.push(`Read ${list(dates.map((d) => d.name))} as ${order} dates.`);
  }
  for (const { name, step } of withStep('split')) {
    summary.push(`Split ${name} into ${step.parts[0]} and ${step.parts[1]}.`);
  }
  for (const { name, step } of withStep('rank')) {
    summary.push(`Add ${step.newColumn}, the number at the start of ${name}, so it sorts in the right order.`);
  }
  if (duplicateRows > 0) summary.push('Remove rows that are exact copies of another row.');

  return { ...draft, summary };
}

/** Columns that have a step of this kind, with the step. Used by the writers. */
export function stepsOf<K extends ColumnStep['kind']>(
  plan: FixPlan,
  kind: K,
): { name: string; step: Extract<ColumnStep, { kind: K }> }[] {
  return plan.columns.flatMap((column) => {
    const step = column.steps.find((s): s is Extract<ColumnStep, { kind: K }> => s.kind === kind);
    return step ? [{ name: column.name, step }] : [];
  });
}

/** A name safe to use as a table or file name: letters, digits and underscores. */
export function slug(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '');
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned === '' || /^\d/.test(cleaned) ? `file_${cleaned}`.replace(/_$/, '') : cleaned;
}
