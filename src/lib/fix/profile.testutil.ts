import type { TestDb } from '../profile/duckdbNode.testutil';
import { columnFactsSql, shapesAllSql, toColumnFacts, valueCountsSql } from '../profile/factsSql';
import { createTableSql, readCsvSql } from '../profile/sql';
import type { Region } from '../region';
import { decideColumns } from '../rules/decide';
import type { PreparedSource } from '../source/types';
import { buildFixPlan, type FixPlan, type PlanColumn } from './plan';

let tables = 0;

/** Loads a prepared file into the test database and builds its fix plan, as the app would. */
export async function planForTest(
  db: TestDb,
  fileName: string,
  source: PreparedSource,
  region: Region = 'UK',
): Promise<FixPlan> {
  const table = `fix${(tables += 1)}`;
  db.addFile(`${table}.csv`, await source.data.text());
  db.run(
    createTableSql(
      table,
      readCsvSql({
        fileName: `${table}.csv`,
        delimiter: source.format.delimiter,
        hasHeader: source.format.hasHeader,
        skipBrokenRows: false,
      }),
      false,
    ),
  );
  db.run(valueCountsSql(table));
  const evidence = new Map(db.rows(columnFactsSql()).map((r) => [String(r.column_name), r]));
  const shapes = new Map<string, { value: string }[]>();
  for (const row of db.rows(shapesAllSql())) {
    const name = String(row.column_name);
    shapes.set(name, [...(shapes.get(name) ?? []), { value: String(row.value) }]);
  }
  const facts = db.rows(`DESCRIBE "${table}"`).map((r) => {
    const name = String(r.column_name);
    return { name, facts: toColumnFacts(evidence.get(name) ?? { filled: 0, distinct_values: 0 }) };
  });
  const [{ n, d }] = db.rows(
    `SELECT count(*) AS n, (SELECT count(*) FROM (SELECT DISTINCT * FROM "${table}")) AS d FROM "${table}"`,
  );
  const decided = decideColumns(facts, Number(n), region);
  const columns: PlanColumn[] = decided.map((c, i) => ({
    name: c.name,
    facts: facts[i].facts,
    decision: c.decision,
    shapes: shapes.get(c.name),
  }));
  const { details, format } = source;
  return buildFixPlan(
    {
      kind: details.kind,
      fileName,
      delimiter: format.delimiter,
      encoding: format.encoding,
      hasHeader: format.hasHeader,
      sheetName: details.sheets?.[details.sheetIndex ?? 0]?.name,
      headerRow: details.headerRow,
      listPath: details.listPath,
      jsonLines: details.jsonLines,
    },
    columns,
    Number(n) - Number(d),
  );
}
