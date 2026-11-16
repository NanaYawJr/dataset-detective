import { stepsOf, type FixPlan } from './plan';

/**
 * Writes the fix plan as a Power Query (M) query, for Power BI or Excel:
 * Get Data > Blank Query > Advanced Editor, and paste.
 */

const ENCODINGS = { 'utf-8': 65001, 'utf-8-bom': 65001, 'utf-16le': 1200, 'utf-16be': 1201, 'windows-1252': 1252 };
const CULTURES = { 'day-first': 'en-GB', 'month-first': 'en-US', 'year-first': 'en-GB' };

const m = (text: string) => `"${text.replaceAll('"', '""').replaceAll('\t', '#(tab)')}"`;
const mList = (items: string[]) => `{${items.map(m).join(', ')}}`;

interface Step {
  name: string;
  expression: string;
  comment?: string;
}

/** For JSON: expands nested records level by level, so "address.geo.lat" comes out as a column. */
function expansions(columns: string[]): { prefix: string; children: string[] }[] {
  const found: { prefix: string; children: string[] }[] = [];
  const depth = Math.max(0, ...columns.map((name) => name.split('.').length));
  for (let level = 1; level < depth; level += 1) {
    const byPrefix = new Map<string, Set<string>>();
    for (const name of columns) {
      const parts = name.split('.');
      if (parts.length <= level) continue;
      const prefix = parts.slice(0, level).join('.');
      byPrefix.set(prefix, (byPrefix.get(prefix) ?? new Set()).add(parts[level]));
    }
    for (const [prefix, children] of byPrefix) found.push({ prefix, children: [...children] });
  }
  return found;
}

function sourceSteps(plan: FixPlan): Step[] {
  const { source } = plan;
  const steps: Step[] = [];
  const add = (name: string, expression: string, comment?: string) => steps.push({ name, expression, comment });

  switch (source.kind) {
    case 'excel': {
      add('Workbook', 'Excel.Workbook(File.Contents(FilePath), null, true)');
      add('Sheet', `Workbook{[Item = ${m(source.sheetName ?? '')}, Kind = "Sheet"]}[Data]`);
      const first = plan.columns[0]?.name ?? '';
      if ((source.headerRow ?? 1) > 1 && source.hasHeader) {
        add(
          'BelowTitle',
          `Table.Skip(Sheet, each not List.Contains(Record.ToList(_), ${m(first)}))`,
          'Rows above the header (a title or notes) are skipped.',
        );
      }
      const from = steps[steps.length - 1].name;
      add('Headers', source.hasHeader ? `Table.PromoteHeaders(${from}, [PromoteAllScalars = true])` : from);
      break;
    }
    case 'parquet':
      add(
        'Headers',
        'Parquet.Document(File.Contents(FilePath))',
        'Parquet carries its own types, so columns arrive already typed.',
      );
      break;
    case 'json': {
      if (source.jsonLines) {
        add('Lines', 'Lines.FromBinary(File.Contents(FilePath), null, null, 65001)');
        add('Records', 'List.Transform(List.Select(Lines, each Text.Trim(_) <> ""), Json.Document)');
      } else {
        add('Json', 'Json.Document(File.Contents(FilePath))');
        const path = (source.listPath ?? '').split('.').filter(Boolean);
        add(
          'Records',
          path.reduce((expression, key) => `Record.Field(${expression}, ${m(key)})`, 'Json'),
        );
      }
      add('Flat', 'Table.FromRecords(Records, null, MissingField.UseNull)');
      let previous = 'Flat';
      expansions(plan.columns.map((c) => c.name)).forEach(({ prefix, children }, i) => {
        const name = `Expanded${i + 1}`;
        add(
          name,
          `Table.ExpandRecordColumn(${previous}, ${m(prefix)}, ${mList(children)}, ${mList(children.map((child) => `${prefix}.${child}`))})`,
          i === 0 ? 'Nested objects become columns named with a dot.' : undefined,
        );
        previous = name;
      });
      add('Headers', previous);
      break;
    }
    default: {
      add(
        'Source',
        `Csv.Document(File.Contents(FilePath), [Delimiter = ${m(source.delimiter)}, Encoding = ${ENCODINGS[source.encoding]}, QuoteStyle = QuoteStyle.Csv])`,
        'Every column is read as text, so nothing is converted by guesswork.',
      );
      add(
        'Headers',
        source.hasHeader
          ? 'Table.PromoteHeaders(Source, [PromoteAllScalars = true])'
          : 'Table.RenameColumns(Source, List.Zip({Table.ColumnNames(Source), List.Transform({1..Table.ColumnCount(Source)}, each "Column " & Text.From(_))}))',
      );
    }
  }
  return steps;
}

export function toPowerQuery(plan: FixPlan): string {
  const steps = sourceSteps(plan);
  const last = () => steps[steps.length - 1].name;
  const add = (name: string, expression: string, comment?: string) => steps.push({ name, expression, comment });
  const transform = (name: string, entries: string[], comment: string) =>
    add(
      name,
      `Table.TransformColumns(${last()}, {\n${entries.map((entry) => `        ${entry}`).join(',\n')}\n    })`,
      comment,
    );

  if (plan.source.kind === 'delimited' || plan.source.kind === 'excel') {
    add('Named', `Table.TransformColumnNames(${last()}, Text.Trim)`, 'Spaces around column names are removed.');
  }

  add(
    'Blanks',
    `Table.TransformColumns(${last()}, {}, each if _ is text then (if Text.Trim(_) = "" then null else Text.Trim(_)) else _)`,
    'Spaces around values are removed, and empty values become null.',
  );

  const dropped = stepsOf(plan, 'drop').map((d) => d.name);
  if (dropped.length > 0)
    add('Removed', `Table.RemoveColumns(${last()}, ${mList(dropped)}, MissingField.Ignore)`, 'Empty columns.');

  const placeholders = stepsOf(plan, 'null-placeholders');
  if (placeholders.length > 0) {
    transform(
      'Placeholders',
      placeholders.map(
        ({ name, step }) =>
          `{${m(name)}, each if _ is text and List.Contains(${mList(step.values)}, _) then null else _}`,
      ),
      'Placeholders that stand for "missing" become null, so they are counted as missing.',
    );
  }

  const numbers = stepsOf(plan, 'number');
  if (numbers.length > 0) {
    transform(
      'Numbers',
      numbers.map(({ name, step }) =>
        step.whole
          ? `{${m(name)}, each ToWholeNumber(_, ${mList(step.remove)}), Int64.Type}`
          : `{${m(name)}, each ToNumber(_, ${mList(step.remove)}, ${step.percent ? 100 : 1}), type nullable number}`,
      ),
      'Numbers. A percentage such as "5%" becomes 0.05.',
    );
  }

  const dates = stepsOf(plan, 'date');
  if (dates.length > 0) {
    transform(
      'Dates',
      dates.map(({ name, step }) =>
        step.withTime
          ? `{${m(name)}, each ToDateTime(_, ${m(CULTURES[step.order])}), type nullable datetime}`
          : `{${m(name)}, each ToDate(_, ${m(CULTURES[step.order])}), type nullable date}`,
      ),
      'Dates, read in the order the profile established: en-GB is day-first, en-US is month-first.',
    );
  }

  stepsOf(plan, 'rank').forEach(({ name, step }, i) => {
    add(
      `Ranked${i + 1}`,
      `Table.AddColumn(${last()}, ${m(step.newColumn)}, each try Int64.From(Text.Select(Text.Start(Text.From(Record.Field(_, ${m(name)})), 2), {"0".."9"})) otherwise null, Int64.Type)`,
      `${name} is a rank written into text. A number column lets it sort in the right order.`,
    );
  });

  stepsOf(plan, 'split').forEach(({ name, step }, i) => {
    add(
      `Split${i + 1}`,
      `Table.SplitColumn(${last()}, ${m(name)}, Splitter.SplitTextByEachDelimiter({${m(step.separator)}}, QuoteStyle.None, false), ${mList(step.parts)})`,
      `${name} holds two fields in one column.`,
    );
    add(
      `Trimmed${i + 1}`,
      `Table.TransformColumns(${last()}, {{${m(step.parts[0])}, Text.Trim, type text}, {${m(step.parts[1])}, Text.Trim, type text}})`,
    );
  });

  // Text columns keep a text type when the source was text; typed sources may hold lists, which have no text type.
  if (plan.source.kind === 'delimited' || plan.source.kind === 'excel') {
    const text = plan.columns
      .filter((c) => c.target === 'text' && !c.steps.some((s) => s.kind === 'drop' || s.kind === 'split'))
      .map((c) => `{${m(c.name)}, type text}`);
    if (text.length > 0)
      add('Typed', `Table.TransformColumnTypes(${last()}, {${text.join(', ')}})`, 'The remaining columns are text.');
  }

  if (plan.removeDuplicateRows)
    add('Distinct', `Table.Distinct(${last()})`, 'Rows that are exact copies of another row.');

  const usesTime = dates.some((d) => d.step.withTime);
  const body = steps
    .flatMap(({ name, expression, comment }) => [
      ...(comment ? ['', `    // ${comment}`] : []),
      `    ${name} = ${expression},`,
    ])
    .join('\n');
  const result = last();

  return `// Cleans ${plan.source.fileName}, following its Dataset Detective profile.
// In Power BI or Excel: Get Data > Blank Query > Advanced Editor, paste this, and change FilePath.
let
    FilePath = ${m(`C:\\Data\\${plan.source.fileName}`)},

    // Helpers. A value that can't be converted becomes null: never an error, never a wrong value.
    ToNumber = (value as any, remove as list, divideBy as number) as nullable number =>
        if value = null then null
        else if value is number then value
        else try Number.FromText(Text.Trim(Text.Remove(Text.From(value), remove)), "en-GB") / divideBy otherwise null,
    ToWholeNumber = (value as any, remove as list) as nullable number =>
        let n = ToNumber(value, remove, 1) in if n = null or Number.Mod(n, 1) <> 0 then null else Int64.From(n),
    ToDate = (value as any, culture as text) as nullable date =>
        if value = null then null
        else if value is datetime then DateTime.Date(value)
        else if value is date then value
        else try Date.FromText(Text.From(value), culture) otherwise null,${
          usesTime
            ? `
    ToDateTime = (value as any, culture as text) as nullable datetime =>
        if value = null then null
        else if value is datetime then value
        else try DateTime.FromText(Text.From(value), culture) otherwise null,`
            : ''
        }
${body}

    Result = ${result}
in
    Result
`;
}
