import type { ColumnDecision } from '../rules/types';
import type { SourceDetails, SourceNote } from './types';

/**
 * Compares the type a file declares for each column with what the values
 * turned out to be. A column declared as text that holds dates or amounts
 * sorts, filters and sums as text until it is converted, and nothing about
 * the file warns of it.
 */

const NOTE_KEY = 'declared-mismatch';
const NUMERIC = ['integer', 'decimal', 'percent', 'currency'];

export function declaredMismatchNote(
  declared: Record<string, string>,
  columns: { name: string; decision: ColumnDecision }[],
): SourceNote | null {
  const found: string[] = [];
  for (const { name, decision } of columns) {
    if (declared[name] !== 'text') continue;
    if (decision.type === 'date') found.push(`"${name}" holds dates`);
    // Codes and phone numbers are rightly text; only numbers meant for arithmetic count.
    else if (NUMERIC.includes(decision.type) && decision.role === 'measure') found.push(`"${name}" holds numbers`);
  }
  if (found.length === 0) return null;
  const shown = found.slice(0, 4).join(', ');
  const more = found.length > 4 ? ` and ${found.length - 4} more` : '';
  return {
    key: NOTE_KEY,
    title: `${found.length === 1 ? '1 column is' : `${found.length} columns are`} declared as text but ${found.length === 1 ? 'holds' : 'hold'} dates or numbers`,
    detail: `${shown}${more}. Anything reading this file will treat ${found.length === 1 ? 'it' : 'them'} as text: sorting, date filters and sums will be wrong until ${found.length === 1 ? 'it is' : 'they are'} converted.`,
  };
}

/** The source details with the mismatch note brought up to date for these decisions. */
export function withDeclaredNote(
  details: SourceDetails,
  columns: { name: string; decision: ColumnDecision }[],
): SourceDetails {
  if (!details.declaredTypes) return details;
  const notes = details.notes.filter((note) => note.key !== NOTE_KEY);
  const note = declaredMismatchNote(details.declaredTypes, columns);
  return { ...details, notes: note ? [...notes, note] : notes };
}
