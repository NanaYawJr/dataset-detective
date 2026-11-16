import type { FileMetaData, SchemaElement } from 'hyparquet';
import type { CsvBuilder } from './csvText';

/**
 * Reads a Parquet file. Parquet declares a type for every column; the
 * declared types are reported, and the values are written out as text so
 * they go through the same evidence-based checks as any other file. A
 * column declared as text can still hold nothing but numbers.
 */

export type DeclaredType =
  'text' | 'whole number' | 'decimal' | 'true/false' | 'date' | 'date and time' | 'time' | 'list' | 'nested record';

export interface ParquetColumn {
  name: string;
  declared: DeclaredType;
}

export interface ParquetFile {
  columns: ParquetColumn[];
  rowCount: number;
  /** The program that wrote the file, as recorded in it. */
  createdBy?: string;
  /** Writes every row to the builder as text, one row group at a time. */
  writeRows(builder: CsvBuilder): Promise<void>;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

export function declaredType(element: SchemaElement): DeclaredType {
  if (element.num_children)
    return element.converted_type === 'LIST' || element.converted_type === 'MAP' ? 'list' : 'nested record';
  if (element.repetition_type === 'REPEATED') return 'list';
  const logical = element.logical_type?.type ?? element.converted_type ?? '';
  if (logical === 'DATE') return 'date';
  if (logical.startsWith('TIMESTAMP')) return 'date and time';
  if (logical.startsWith('TIME')) return 'time';
  if (logical === 'DECIMAL') return 'decimal';
  if (/^U?INT/.test(logical) || logical === 'INTEGER') return 'whole number';
  switch (element.type) {
    case 'BOOLEAN':
      return 'true/false';
    case 'INT32':
    case 'INT64':
      return 'whole number';
    case 'INT96':
      return 'date and time';
    case 'FLOAT':
    case 'DOUBLE':
      return 'decimal';
    default:
      return 'text';
  }
}

/** The top-level columns of the file: the schema is a flattened tree, so children are skipped. */
export function topLevelColumns(schema: SchemaElement[]): ParquetColumn[] {
  const columns: ParquetColumn[] = [];
  const skip = (at: number): number => {
    let next = at + 1;
    for (let child = 0; child < (schema[at].num_children ?? 0); child += 1) next = skip(next);
    return next;
  };
  for (let at = 1; at < schema.length; at = skip(at)) {
    columns.push({ name: schema[at].name, declared: declaredType(schema[at]) });
  }
  return columns;
}

function dateText(date: Date, withTime: boolean): string {
  if (Number.isNaN(date.getTime())) return '';
  const day = `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  if (!withTime) return day;
  const ms = date.getUTCMilliseconds();
  const time = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
  return `${day} ${time}${ms ? `.${pad(ms, 3)}` : ''}`;
}

function nestedText(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v === 'bigint') return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
    if (v instanceof Uint8Array) return `(${v.length} bytes)`;
    return v;
  });
}

export function valueText(value: unknown, declared: DeclaredType): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) return dateText(value, declared !== 'date');
  if (value instanceof Uint8Array) return `(${value.length} bytes)`;
  return nestedText(value);
}

export async function openParquet(buffer: ArrayBuffer): Promise<ParquetFile> {
  const [{ parquetMetadataAsync, parquetReadObjects }, { compressors }] = await Promise.all([
    import('hyparquet'),
    import('hyparquet-compressors'),
  ]);
  const metadata: FileMetaData = await parquetMetadataAsync(buffer);
  const columns = topLevelColumns(metadata.schema);

  return {
    columns,
    rowCount: Number(metadata.num_rows),
    createdBy: metadata.created_by,
    async writeRows(builder) {
      let start = 0;
      for (const group of metadata.row_groups) {
        const end = start + Number(group.num_rows);
        const rows = await parquetReadObjects({ file: buffer, metadata, compressors, rowStart: start, rowEnd: end });
        for (const row of rows) builder.add(columns.map((c) => valueText(row[c.name], c.declared)));
        start = end;
      }
    },
  };
}
