// Generates samples/sales-sample.csv: a synthetic sales extract with known,
// deliberate data quality problems. The output is deterministic (seeded),
// so tests can rely on exact figures. Run with: npm run sample
//
// Deliberate problems:
//   - Order ID repeats: one row per order line, not per order
//   - Discount stored as text with a % sign ("5%")
//   - "City | Region" packs two fields into one column
//   - "4-Not Specified" is a placeholder standing in for a missing priority
//   - Order Priority encodes a rank in its text ("1-Urgent" … "5-Low")
//   - Dates are day-first text (dd/mm/yyyy); no orders at all in July
//   - A handful of rows ship before they were ordered
//   - Profit is heavily skewed by a few very large lines
//   - Customer Email holds personal data (example.com addresses only)

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ORDERS = 800;
const SHIP_BEFORE_ORDER = 4;

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(20261021);
const int = (min, max) => min + Math.floor(random() * (max - min + 1));
const pick = (list) => list[Math.floor(random() * list.length)];

const PRIORITIES = ['1-Urgent', '2-High', '3-Medium', '4-Not Specified', '5-Low'];
const SHIP_MODES = ['Regular Air', 'Regular Air', 'Regular Air', 'Regular Air', 'Delivery Truck', 'Express Air'];
const SEGMENTS = ['Corporate', 'Consumer', 'Small Business', 'Home Office'];
const PLACES = [
  'Leeds | Yorkshire and the Humber',
  'Sheffield | Yorkshire and the Humber',
  'York | Yorkshire and the Humber',
  'Manchester | North West',
  'Liverpool | North West',
  'Newcastle | North East',
  'Birmingham | West Midlands',
  'Nottingham | East Midlands',
  'Bristol | South West',
  'London | London',
  'Cardiff | Wales',
  'Glasgow | Scotland',
];
const DISCOUNTS = ['0%', '1%', '2%', '3%', '4%', '5%', '6%', '7%', '8%', '9%', '10%'];

const pad = (n) => String(n).padStart(2, '0');
const ukDate = (d) => `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;

function orderDate() {
  // Any day in 2025 except July (month index 6), which is left empty on purpose.
  for (;;) {
    const d = new Date(Date.UTC(2025, 0, 1 + int(0, 364)));
    if (d.getUTCMonth() !== 6) return d;
  }
}

function profit() {
  const r = random();
  if (r < 0.03) return int(2000, 9500) + random(); // a few very large wins
  if (r < 0.05) return -int(1500, 8000) - random(); // and large losses
  return (random() - 0.48) * 60; // most lines are close to break-even
}

function quote(value) {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

const header = [
  'Order ID',
  'Order Date',
  'Ship Date',
  'Order Priority',
  'Order Quantity',
  'Discount',
  'Unit Price',
  'Profit',
  'Ship Mode',
  'City | Region',
  'Customer Segment',
  'Customer Email',
];

const lines = [header.join(',')];
let orderId = 1000;
const rows = [];

for (let o = 0; o < ORDERS; o += 1) {
  orderId += int(1, 40);
  const ordered = orderDate();
  const priority = pick(PRIORITIES);
  const place = pick(PLACES);
  const segment = pick(SEGMENTS);
  const customer = int(1, 400);
  const lineCount = random() < 0.65 ? 1 : int(2, 4);

  for (let l = 0; l < lineCount; l += 1) {
    const shipped = new Date(ordered.getTime() + int(0, 7) * 86_400_000);
    rows.push({
      orderId,
      ordered,
      shipped,
      priority,
      quantity: int(1, 50),
      discount: pick(DISCOUNTS),
      unitPrice: (int(150, 50000) / 100).toFixed(2),
      profit: profit().toFixed(2),
      shipMode: pick(SHIP_MODES),
      place,
      segment,
      email: `customer${customer}@example.com`,
    });
  }
}

// Make a few rows ship before they were ordered (every 97th row, for determinism).
for (let i = 0; i < SHIP_BEFORE_ORDER; i += 1) {
  const row = rows[50 + i * 97];
  row.shipped = new Date(row.ordered.getTime() - int(1, 5) * 86_400_000);
}

for (const r of rows) {
  lines.push(
    [
      r.orderId,
      ukDate(r.ordered),
      ukDate(r.shipped),
      r.priority,
      r.quantity,
      r.discount,
      r.unitPrice,
      r.profit,
      r.shipMode,
      r.place,
      r.segment,
      r.email,
    ]
      .map((v) => quote(String(v)))
      .join(','),
  );
}

const out = fileURLToPath(new URL('../samples/sales-sample.csv', import.meta.url));
writeFileSync(out, `${lines.join('\n')}\n`);
console.log(`Wrote ${rows.length} rows to samples/sales-sample.csv`);
