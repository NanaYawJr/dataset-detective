/**
 * A minimal scanner for the machine-written XML inside an Excel workbook.
 * It walks the text once and reports tags and text as it meets them, so a
 * large worksheet never has to be held as a tree in memory. It is not a
 * general XML parser: no DTDs, no validation.
 */

export interface XmlHandlers {
  /** `attrs` is the raw attribute text; read it with `attr`. */
  open?(name: string, attrs: string, selfClosing: boolean): void;
  close?(name: string): void;
  text?(text: string): void;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (whole, code: string) => {
    if (code[0] === '#') {
      const point = code[1] === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(point) && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
    }
    return ENTITIES[code] ?? whole;
  });
}

/** Reads one attribute from the raw attribute text of a tag. */
export function attr(attrs: string, name: string): string | undefined {
  for (const quote of ['"', "'"]) {
    const marker = ` ${name}=${quote}`;
    const start = attrs.indexOf(marker);
    if (start === -1) continue;
    const from = start + marker.length;
    const end = attrs.indexOf(quote, from);
    if (end !== -1) return decodeEntities(attrs.slice(from, end));
  }
  return undefined;
}

/** Tag name without any namespace prefix: `x:row` and `row` are the same tag. */
function localName(name: string): string {
  const colon = name.indexOf(':');
  return colon === -1 ? name : name.slice(colon + 1);
}

/** Index of the `>` that ends the tag starting at `from`, ignoring any inside quoted values. */
function tagEnd(xml: string, from: number): number {
  let quote = '';
  for (let i = from; i < xml.length; i += 1) {
    const ch = xml[i];
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '>') return i;
  }
  return -1;
}

export function scanXml(xml: string, handlers: XmlHandlers): void {
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) break;
    if (lt > i && handlers.text) handlers.text(decodeEntities(xml.slice(i, lt)));

    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      i = end === -1 ? xml.length : end + 3;
    } else if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      handlers.text?.(xml.slice(lt + 9, end === -1 ? xml.length : end));
      i = end === -1 ? xml.length : end + 3;
    } else if (xml[lt + 1] === '?' || xml[lt + 1] === '!') {
      const end = xml.indexOf('>', lt);
      i = end === -1 ? xml.length : end + 1;
    } else if (xml[lt + 1] === '/') {
      const end = xml.indexOf('>', lt);
      if (end === -1) break;
      handlers.close?.(localName(xml.slice(lt + 2, end).trim()));
      i = end + 1;
    } else {
      const end = tagEnd(xml, lt + 1);
      if (end === -1) break;
      const selfClosing = xml[end - 1] === '/';
      const inner = xml.slice(lt + 1, selfClosing ? end - 1 : end);
      const space = inner.search(/\s/);
      const name = localName(space === -1 ? inner : inner.slice(0, space));
      const attrs = space === -1 ? '' : ` ${inner.slice(space + 1).replace(/\s+/g, ' ')}`;
      handlers.open?.(name, attrs, selfClosing);
      if (selfClosing) handlers.close?.(name);
      i = end + 1;
    }
  }
}
