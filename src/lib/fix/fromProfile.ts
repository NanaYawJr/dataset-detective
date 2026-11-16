import type { ProfileResult } from '../profile/types';
import { buildFixPlan, type FixPlan } from './plan';

/** The fix plan for a profiled file. */
export function fixPlanFor(result: ProfileResult): FixPlan {
  const { source, format } = result;
  const duplicates = result.table?.findings.find((finding) => finding.kind === 'duplicate-rows')?.rows ?? 0;
  return buildFixPlan(
    {
      kind: source.kind,
      fileName: result.fileName,
      delimiter: format.delimiter,
      encoding: format.encoding,
      hasHeader: format.hasHeader,
      sheetName: source.sheets?.[source.sheetIndex ?? 0]?.name,
      headerRow: source.headerRow,
      listPath: source.listPath,
      jsonLines: source.jsonLines,
    },
    result.columns,
    duplicates,
  );
}
