// Writes samples/sales-sample-previous.csv: the sales sample as it might
// have looked one delivery earlier, to try "Compare with an earlier version".
//
// Compared with it, the current sample:
//   - adds December 2025's orders, so it runs a month further;
//   - adds the "4-Not Specified" placeholder (earlier it was "5-Low");
//   - renames Customer_Segment to Customer Segment;
//   - adds the Customer Email column;
//   - no longer uses the "Mail" ship mode.
//
// Run: node scripts/make-previous.mjs

import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const text = readFileSync(new URL('samples/sales-sample.csv', root), 'utf8');

// The sample has no quoted fields, so a plain split is enough; a row of the wrong length stops the script.
const [headerLine, ...lines] = text.trimEnd().split('\n');
const header = headerLine.split(',');
const at = (name) => header.indexOf(name);

const keep = header.filter((name) => name !== 'Customer Email');
const out = [keep.map((name) => (name === 'Customer Segment' ? 'Customer_Segment' : name)).join(',')];

let row = 0;
for (const line of lines) {
  const fields = line.split(',');
  if (fields.length !== header.length) throw new Error(`Unexpected field count: ${line}`);
  if (fields[at('Order Date')].endsWith('/12/2025')) continue;
  row += 1;
  if (fields[at('Order Priority')] === '4-Not Specified') fields[at('Order Priority')] = '5-Low';
  if (fields[at('Ship Mode')] === 'Delivery Truck' && row % 9 === 0) fields[at('Ship Mode')] = 'Mail';
  out.push(keep.map((name) => fields[at(name)]).join(','));
}

writeFileSync(new URL('samples/sales-sample-previous.csv', root), `${out.join('\n')}\n`);
console.log(`Wrote ${out.length - 1} rows.`);
