/**
 * Minimal quote-aware parser for delimited text.
 *
 * Used only on a sample from the start of a file, to detect the delimiter,
 * header row and broken rows before the full file is handed to DuckDB.
 * It follows RFC 4180: fields may be wrapped in double quotes, a doubled
 * quote ("") inside a quoted field is a literal quote, and quoted fields
 * may contain delimiters and line breaks.
 */

export interface ParsedRecord {
  fields: string[];
  /** 1-based line number in the source text where the record starts. */
  line: number;
}

export interface ParseResult {
  records: ParsedRecord[];
  /** True when the text ended inside a quoted field. */
  unterminatedQuote: boolean;
}

export function parseRecords(text: string, delimiter: string, maxRecords = Number.POSITIVE_INFINITY): ParseResult {
  const records: ParsedRecord[] = [];
  let fields: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let recordStartLine = 1;
  let i = 0;

  const endRecord = () => {
    fields.push(field);
    // A completely empty line is not a record.
    if (!(fields.length === 1 && fields[0] === '')) {
      records.push({ fields, line: recordStartLine });
    }
    fields = [];
    field = '';
  };

  while (i < text.length && records.length < maxRecords) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      if (ch === '\n') line += 1;
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"' && field === '') {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (ch === delimiter) {
      fields.push(field);
      field = '';
      i += 1;
      continue;
    }

    if (ch === '\r' || ch === '\n') {
      endRecord();
      // Treat \r\n as a single line break.
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      i += 1;
      line += 1;
      recordStartLine = line;
      continue;
    }

    field += ch;
    i += 1;
  }

  const unterminatedQuote = inQuotes;
  if (records.length < maxRecords && !inQuotes && (field !== '' || fields.length > 0)) {
    endRecord();
  }

  return { records, unterminatedQuote };
}
