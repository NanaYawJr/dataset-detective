/**
 * Turns a JSON file into a table. A table needs a list of records, so this
 * looks for one: the file itself may be a list, or one line per record
 * (JSON Lines), or an object that holds the list under a key such as
 * "data" or "results".
 */

export type JsonProblem = 'invalid' | 'no-records';

export class JsonError extends Error {
  readonly problem: JsonProblem;
  constructor(problem: JsonProblem, message: string) {
    super(message);
    this.problem = problem;
  }
}

export interface JsonTable {
  header: string[];
  rows: string[][];
  /** How the records were written. */
  shape: 'list' | 'lines' | 'list-under-key';
  /** For 'list-under-key': where the list was found, such as "data" or "result.records". */
  listPath?: string;
  /** Other lists in the file that were not used. */
  otherLists: string[];
  /** Columns that came from inside a nested object, such as "address.city". */
  nestedColumns: string[];
  /** Columns whose values are lists, kept as JSON text. */
  listColumns: string[];
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const MAX_DEPTH = 6;
const isRecord = (value: Json): value is { [key: string]: Json } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function parseLines(text: string): Json[] | null {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) return null;
  const records: Json[] = [];
  for (const line of lines) {
    try {
      records.push(JSON.parse(line) as Json);
    } catch {
      return null;
    }
  }
  return records;
}

/** Lists of records anywhere in the first few levels of an object, with their paths. */
function findLists(value: Json, path: string, depth: number, found: { path: string; list: Json[] }[]): void {
  if (!isRecord(value) || depth > 3) return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (Array.isArray(child)) {
      if (child.length > 0 && child.some(isRecord)) found.push({ path: childPath, list: child });
    } else findLists(child, childPath, depth + 1, found);
  }
}

function scalarText(value: Json): string {
  if (value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

export function readJson(text: string, fileName = ''): JsonTable {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const linesFirst = /\.(jsonl|ndjson)$/i.test(fileName);

  let shape: JsonTable['shape'] = 'list';
  let records: Json[] | null = null;
  let listPath: string | undefined;
  let otherLists: string[] = [];

  if (linesFirst) records = parseLines(body);
  if (records) shape = 'lines';
  else {
    let parsed: Json;
    try {
      parsed = JSON.parse(body) as Json;
    } catch (error) {
      const lines = linesFirst ? null : parseLines(body);
      if (!lines) throw new JsonError('invalid', error instanceof Error ? error.message : String(error));
      parsed = lines;
      shape = 'lines';
    }
    if (Array.isArray(parsed)) records = parsed;
    else {
      const lists: { path: string; list: Json[] }[] = [];
      findLists(parsed, '', 0, lists);
      if (lists.length === 0) throw new JsonError('no-records', 'No list of records was found in the file.');
      // With several lists, the longest is the data; the others are usually lookups or metadata.
      const chosen = lists.reduce((best, next) => (next.list.length > best.list.length ? next : best));
      records = chosen.list;
      shape = 'list-under-key';
      listPath = chosen.path;
      otherLists = lists.filter((l) => l !== chosen).map((l) => l.path);
    }
  }
  if (records.length === 0) throw new JsonError('no-records', 'The list of records is empty.');

  const index = new Map<string, number>();
  const nested = new Set<string>();
  const lists = new Set<string>();
  const sparse: Map<number, string>[] = [];

  const column = (name: string): number => {
    let at = index.get(name);
    if (at === undefined) {
      at = index.size;
      index.set(name, at);
    }
    return at;
  };

  const flatten = (value: { [key: string]: Json }, prefix: string, depth: number, into: Map<number, string>) => {
    for (const [key, child] of Object.entries(value)) {
      const name = prefix + key;
      if (isRecord(child) && depth < MAX_DEPTH) {
        flatten(child, `${name}.`, depth + 1, into);
        continue;
      }
      const at = column(name);
      if (prefix) nested.add(name);
      if (Array.isArray(child)) lists.add(name);
      into.set(at, scalarText(child));
    }
  };

  for (const record of records) {
    const cells = new Map<number, string>();
    if (isRecord(record)) flatten(record, '', 0, cells);
    else cells.set(column('value'), scalarText(record));
    sparse.push(cells);
  }

  const header = [...index.keys()];
  const rows = sparse.map((cells) => header.map((_, i) => cells.get(i) ?? ''));
  return { header, rows, shape, listPath, otherLists, nestedColumns: [...nested], listColumns: [...lists] };
}
