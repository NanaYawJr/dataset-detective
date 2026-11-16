import { slug, stepsOf, type FixPlan } from './plan';

/** Writes the fix plan as a pandas script. */

const ENCODINGS = {
  'utf-8': 'utf-8',
  'utf-8-bom': 'utf-8-sig',
  'utf-16le': 'utf-16',
  'utf-16be': 'utf-16',
  'windows-1252': 'cp1252',
};

/** A Python string literal. JSON's escapes are all valid in Python. */
const py = (text: string) => JSON.stringify(text);
const pyList = (items: string[]) => `[${items.map(py).join(', ')}]`;

function readLines({ source }: FixPlan): string[] {
  switch (source.kind) {
    case 'excel':
      return [
        '# Read the sheet as text. Excel stores dates as numbers; pandas writes them out as dates.',
        `df = pd.read_excel(SOURCE, sheet_name=${py(source.sheetName ?? '')}, header=${(source.headerRow ?? 1) - 1}, dtype="string")`,
        '# Columns with no header and no values (spacers beside the table) are not part of it.',
        'df = df.loc[:, ~(df.columns.astype(str).str.startswith("Unnamed") & df.isna().all())]',
      ];
    case 'parquet':
      return ['# Parquet carries its own types, so columns arrive already typed.', 'df = pd.read_parquet(SOURCE)'];
    case 'json': {
      const path = (source.listPath ?? '')
        .split('.')
        .filter(Boolean)
        .map((key) => `[${py(key)}]`)
        .join('');
      const load = source.jsonLines
        ? ['    records = [json.loads(line) for line in file if line.strip()]']
        : [`    records = json.load(file)${path}`];
      return [
        '# Nested objects become columns named with a dot, such as "address.city".',
        'with open(SOURCE, encoding="utf-8-sig") as file:',
        ...load,
        'df = pd.json_normalize(records)',
      ];
    }
    default: {
      const header = source.hasHeader ? '' : ', header=None';
      return [
        '# Every column is read as text, so nothing is converted by guesswork.',
        `df = pd.read_csv(SOURCE, sep=${py(source.delimiter)}, encoding=${py(ENCODINGS[source.encoding])}, dtype="string", keep_default_na=False${header})`,
        ...(source.hasHeader ? [] : ['df.columns = [f"Column {i + 1}" for i in range(df.shape[1])]']),
      ];
    }
  }
}

export function toPandas(plan: FixPlan): string {
  const { source } = plan;
  const name = slug(source.fileName);
  const extras = { excel: ' openpyxl', parquet: ' pyarrow', json: '', delimited: '' }[source.kind];
  const lines: string[] = [
    `"""Cleans ${source.fileName}, following its Dataset Detective profile.`,
    '',
    `Needs:  pip install pandas${extras}`,
    '"""',
    '',
    ...(source.kind === 'json' ? ['import json', ''] : []),
    'import pandas as pd',
    '',
    `SOURCE = ${py(source.fileName)}  # change this to where your copy is saved`,
    '',
    '',
    'def to_number(values, remove=(), divide_by=1):',
    '    """Text such as "5%" or "£1,200" becomes a number. Anything that isn\'t a number becomes blank."""',
    '    if pd.api.types.is_numeric_dtype(values):',
    '        return values',
    '    text = values.astype("string")',
    '    for character in remove:',
    '        text = text.str.replace(character, "", regex=False)',
    '    return pd.to_numeric(text.str.strip(), errors="coerce") / divide_by',
    '',
    '',
    'def to_whole_number(values, remove=()):',
    '    numbers = to_number(values, remove)',
    '    return numbers.where(numbers % 1 == 0).astype("Int64")',
    '',
    '',
    'def to_date(values, order):',
    '    """Dates that can\'t be read in the stated order become blank, not a wrong date."""',
    '    if pd.api.types.is_datetime64_any_dtype(values):',
    '        return values',
    '    if order == "year-first":',
    '        return pd.to_datetime(values, format="ISO8601", errors="coerce")',
    '    return pd.to_datetime(values, format="mixed", dayfirst=(order == "day-first"), errors="coerce")',
    '',
    '',
    ...readLines(plan),
    '',
  ];

  if (source.kind === 'delimited' || source.kind === 'excel') {
    lines.push(
      '# Spaces around column names and values are removed, and empty values become real blanks.',
      'df.columns = df.columns.astype(str).str.strip()',
      'df = df.apply(lambda column: column.str.strip()).replace("", pd.NA)',
      '',
    );
  }

  const dropped = stepsOf(plan, 'drop').map((d) => d.name);
  if (dropped.length > 0) {
    lines.push('# Empty columns.', `df = df.drop(columns=${pyList(dropped)}, errors="ignore")`, '');
  }

  const placeholders = stepsOf(plan, 'null-placeholders');
  if (placeholders.length > 0) {
    lines.push('# Placeholders that stand for "missing" become real blanks, so they are counted as missing.');
    for (const { name: column, step } of placeholders) {
      lines.push(`df[${py(column)}] = df[${py(column)}].mask(df[${py(column)}].isin(${pyList(step.values)}))`);
    }
    lines.push('');
  }

  const numbers = stepsOf(plan, 'number');
  if (numbers.length > 0) {
    lines.push('# Numbers. A percentage such as "5%" becomes 0.05.');
    for (const { name: column, step } of numbers) {
      const remove = step.remove.length > 0 ? `, remove=${pyList(step.remove)}` : '';
      lines.push(
        step.whole
          ? `df[${py(column)}] = to_whole_number(df[${py(column)}]${remove})`
          : `df[${py(column)}] = to_number(df[${py(column)}]${remove}${step.percent ? ', divide_by=100' : ''})`,
      );
    }
    lines.push('');
  }

  const dates = stepsOf(plan, 'date');
  if (dates.length > 0) {
    lines.push('# Dates, read in the order the profile established.');
    for (const { name: column, step } of dates) {
      lines.push(`df[${py(column)}] = to_date(df[${py(column)}], ${py(step.order)})`);
    }
    lines.push('');
  }

  for (const { name: column, step } of stepsOf(plan, 'rank')) {
    lines.push(
      `# ${column} is a rank written into text. A number column lets it sort in the right order.`,
      `df[${py(step.newColumn)}] = pd.to_numeric(df[${py(column)}].str.extract(r"^\\s*(\\d{1,2})", expand=False), errors="coerce").astype("Int64")`,
      '',
    );
  }

  for (const { name: column, step } of stepsOf(plan, 'split')) {
    lines.push(
      `# ${column} holds two fields in one column.`,
      `parts = df[${py(column)}].str.split(${py(step.separator)}, n=1, expand=True)`,
      `df[${py(step.parts[0])}] = parts[0].str.strip()`,
      `df[${py(step.parts[1])}] = parts[1].str.strip()`,
      `df = df.drop(columns=[${py(column)}])`,
      '',
    );
  }

  if (plan.removeDuplicateRows) {
    lines.push('# Rows that are exact copies of another row.', 'df = df.drop_duplicates()', '');
  }

  lines.push(
    'print(df.dtypes)',
    'print(f"{len(df):,} rows")',
    `df.to_csv(${py(`${name}_clean.csv`)}, index=False)`,
    '',
  );
  return lines.join('\n');
}
