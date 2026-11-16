/**
 * Writes rows as CSV text. Excel, Parquet and JSON files are turned into
 * this form in memory so that every format goes through the same reader
 * and the same checks as a CSV file.
 */

const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;

export function csvField(value: string): string {
  return NEEDS_QUOTES.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function csvLine(values: readonly string[]): string {
  // A row holding one empty value is written as "" so it isn't read as a blank line.
  if (values.length === 1 && values[0] === '') return '""\n';
  return `${values.map(csvField).join(',')}\n`;
}

/** Collects CSV text in pieces, so a large file isn't built as one giant string. */
export class CsvBuilder {
  private parts: string[] = [];
  private pending: string[] = [];
  rows = 0;

  add(values: readonly string[]): void {
    this.pending.push(csvLine(values));
    this.rows += 1;
    if (this.pending.length >= 5000) this.flush();
  }

  private flush(): void {
    if (this.pending.length === 0) return;
    this.parts.push(this.pending.join(''));
    this.pending = [];
  }

  toBlob(): Blob {
    this.flush();
    return new Blob(this.parts, { type: 'text/csv' });
  }
}
