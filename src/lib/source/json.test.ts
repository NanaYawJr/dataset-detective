import { describe, expect, it } from 'vitest';
import { JsonError, readJson } from './json';

describe('readJson', () => {
  it('reads a list of records, filling gaps for missing keys', () => {
    const table = readJson('[{"id":1,"name":"Ada"},{"id":2,"city":"Leeds"}]');
    expect(table.shape).toBe('list');
    expect(table.header).toEqual(['id', 'name', 'city']);
    expect(table.rows).toEqual([
      ['1', 'Ada', ''],
      ['2', '', 'Leeds'],
    ]);
  });

  it('reads one record per line', () => {
    const table = readJson('{"a":1}\n{"a":2}\n\n{"a":3}\n', 'events.jsonl');
    expect(table.shape).toBe('lines');
    expect(table.rows).toEqual([['1'], ['2'], ['3']]);
    // The same text is recognised without the file name's help.
    expect(readJson('{"a":1}\n{"a":2}').shape).toBe('lines');
  });

  it('finds the list of records inside an object', () => {
    const text = JSON.stringify({
      total: 2,
      result: { records: [{ id: 1 }, { id: 2 }, { id: 3 }], facets: [{ name: 'x' }] },
    });
    const table = readJson(text);
    expect(table).toMatchObject({ shape: 'list-under-key', listPath: 'result.records', otherLists: ['result.facets'] });
    expect(table.rows).toHaveLength(3);
  });

  it('flattens nested objects and keeps lists as JSON text', () => {
    const table = readJson(
      '[{"id":1,"address":{"city":"Hull","geo":{"lat":53.7}},"tags":["a","b"],"ok":true,"n":null}]',
    );
    expect(table.header).toEqual(['id', 'address.city', 'address.geo.lat', 'tags', 'ok', 'n']);
    expect(table.rows[0]).toEqual(['1', 'Hull', '53.7', '["a","b"]', 'true', '']);
    expect(table.nestedColumns).toEqual(['address.city', 'address.geo.lat']);
    expect(table.listColumns).toEqual(['tags']);
  });

  it('puts a list of plain values in one column', () => {
    expect(readJson('[1, 2, "x"]')).toMatchObject({ header: ['value'], rows: [['1'], ['2'], ['x']] });
  });

  it('ignores a byte-order mark', () => {
    expect(readJson('﻿[{"a":1}]').rows).toEqual([['1']]);
  });

  it('says why a file cannot be used', () => {
    const problem = (text: string) => {
      try {
        readJson(text);
      } catch (error) {
        return error instanceof JsonError ? error.problem : 'other';
      }
      return 'none';
    };
    expect(problem('[{"a":1},')).toBe('invalid');
    expect(problem('{"name":"x","count":3}')).toBe('no-records');
    expect(problem('[]')).toBe('no-records');
    expect(problem('{"data":[]}')).toBe('no-records');
  });
});
