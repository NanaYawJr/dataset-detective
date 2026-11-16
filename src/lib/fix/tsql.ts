import { slug, type ColumnPlan, type FixPlan } from './plan';

/**
 * Writes the fix plan as T-SQL. A file can't be read by a query on its own,
 * so the script starts from a staging table that holds the file as it is,
 * with every column as text, and builds a clean, typed table from it.
 */

const bracket = (name: string) => `[${name.replaceAll(']', ']]')}]`;
const str = (text: string) => `N'${text.replaceAll("'", "''")}'`;
const step = <K extends ColumnPlan['steps'][number]['kind']>(column: ColumnPlan, kind: K) =>
  column.steps.find((s): s is Extract<ColumnPlan['steps'][number], { kind: K }> => s.kind === kind);

/** The value as trimmed text, with blanks and placeholders as NULL. */
function cleanedText(column: ColumnPlan): string {
  const trimmed = `LTRIM(RTRIM(s.${bracket(column.name)}))`;
  const placeholders = step(column, 'null-placeholders');
  if (!placeholders) return `NULLIF(${trimmed}, N'')`;
  return `CASE WHEN ${trimmed} IN (${placeholders.values.map(str).join(', ')}) THEN NULL ELSE NULLIF(${trimmed}, N'') END`;
}

/** The output columns for one input column: usually one, two for a split, an extra one for a rank. */
function outputs(column: ColumnPlan): string[] {
  const c = `c.${bracket(column.name)}`;
  const as = (expression: string, name = column.name) => `${expression} AS ${bracket(name)}`;
  if (step(column, 'drop')) return [];

  const split = step(column, 'split');
  if (split) {
    const sep = str(split.separator);
    return [
      as(`NULLIF(LTRIM(RTRIM(LEFT(${c}, CHARINDEX(${sep}, ${c} + ${sep}) - 1))), N'')`, split.parts[0]),
      as(`NULLIF(LTRIM(RTRIM(STUFF(${c}, 1, CHARINDEX(${sep}, ${c} + ${sep}), N''))), N'')`, split.parts[1]),
    ];
  }

  const lines: string[] = [];
  const number = step(column, 'number');
  const date = step(column, 'date');
  if (number) {
    const stripped = number.remove.reduce((expression, ch) => `REPLACE(${expression}, ${str(ch)}, N'')`, c);
    const converted = `TRY_CONVERT(${number.whole ? 'bigint' : 'decimal(18, 4)'}, ${stripped})`;
    lines.push(as(number.percent ? `${converted} / 100` : converted));
  } else if (date) {
    // 103 is dd/mm/yyyy, 101 is mm/dd/yyyy, 23 is yyyy-mm-dd, 120 is yyyy-mm-dd hh:mi:ss.
    if (date.order === 'year-first') {
      lines.push(as(date.withTime ? `TRY_CONVERT(datetime2(0), ${c}, 120)` : `TRY_CONVERT(date, LEFT(${c}, 10), 23)`));
    } else {
      lines.push(as(`TRY_CONVERT(date, ${c}, ${date.order === 'day-first' ? 103 : 101})`));
    }
  } else {
    lines.push(as(c));
  }

  const rank = step(column, 'rank');
  if (rank) {
    // An empty string converts to 0 in SQL Server, so a value with no leading number is made NULL first.
    lines.push(as(`TRY_CONVERT(int, NULLIF(LEFT(${c}, PATINDEX(N'%[^0-9]%', ${c} + N'x') - 1), N''))`, rank.newColumn));
  }
  return lines;
}

export function toTsql(plan: FixPlan): string {
  const name = slug(plan.source.fileName);
  const kept = plan.columns.filter((column) => !step(column, 'drop'));
  const select = kept.flatMap(outputs);
  const indent = (lines: string[], spaces: number) => lines.map((line) => `${' '.repeat(spaces)}${line}`).join(',\n');

  return `/*
  Cleans ${plan.source.fileName}, following its Dataset Detective profile.

  Before running:
    1. Load the file as it is into a staging table in which every column is
       text (nvarchar). In SQL Server Management Studio: right-click the
       database > Tasks > Import Flat File, and choose nvarchar for every column.
    2. Change the two table names below to yours.

  A value that can't be converted becomes NULL instead of stopping the script,
  so check the counts at the end. Change decimal(18, 4) if you need more decimal places.
*/

DROP TABLE IF EXISTS dbo.${name}_clean;

SELECT${plan.removeDuplicateRows ? ' DISTINCT -- rows that are exact copies of another row are removed' : ''}
${indent(select, 4)}
INTO dbo.${name}_clean
FROM dbo.${name}_staging AS s
-- Trimmed text, with empty values${plan.columns.some((c) => step(c, 'null-placeholders')) ? ' and placeholders' : ''} as NULL.
CROSS APPLY (
    VALUES (
${indent(kept.map(cleanedText), 8)}
    )
) AS c (${kept.map((column) => bracket(column.name)).join(', ')});

-- How many rows came through, to compare with the file.
SELECT COUNT(*) AS rows_loaded FROM dbo.${name}_clean;
`;
}
