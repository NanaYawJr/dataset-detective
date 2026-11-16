import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const sample = (name: string) => fileURLToPath(new URL(`../samples/${name}`, import.meta.url));
const fixture = (name: string) => fileURLToPath(new URL(`../src/lib/source/fixtures/${name}`, import.meta.url));

function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test('profiles an Excel workbook: finds the table, converts dates, switches sheets', async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(sample('sales-sample.xlsx'));

  await expect(page.getByRole('heading', { name: 'sales-sample.xlsx' })).toBeVisible();
  await expect(page.getByTestId('source-line')).toHaveText('Excel workbook · sheet "Orders" · header on row 4');
  await expect(page.getByTestId('stat-rows')).toHaveText('1,378');
  await expect(page.getByTestId('stat-sheet')).toHaveText('Orders');
  await expect(page.getByTestId('note-rows-above-header')).toContainText('The header was found on row 4');
  await expect(page.getByTestId('note-excel-dates')).toContainText('2,756 date cells were converted');

  // The same problems the CSV sample shows, found through the workbook.
  const findings = page.getByRole('region', { name: 'Findings' });
  await expect(findings).toContainText('Ship Date is before Order Date in 4 rows');
  await expect(findings).toContainText('No rows in Jul 2025');
  await expect(page.getByTestId('column-Order Date')).toContainText('year-first (ISO)');

  await page.getByLabel('Sheet').selectOption({ label: 'Regions' });
  await expect(page.getByTestId('source-line')).toHaveText('Excel workbook · sheet "Regions" · header on row 1');
  await expect(page.getByTestId('stat-rows')).toHaveText('12');
  await expect(page.getByTestId('grain')).toHaveText('Each row is one City.');

  expect(errors).toEqual([]);
});

test('reports hidden sheets and formulas that were never calculated', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(fixture('openpyxl.xlsx'));

  // The first sheet holds only a note, so the first sheet with a table is used.
  await expect(page.getByTestId('source-line')).toHaveText('Excel workbook · sheet "Visits" · header on row 3');
  await expect(page.getByTestId('note-formulas-without-result')).toContainText('30 formulas have no stored result');
  await expect(page.getByTestId('note-hidden-sheets')).toContainText('"Lookup" is hidden in Excel');
  await expect(page.getByLabel('Sheet').locator('option')).toHaveText(['Notes', 'Visits', 'Lookup (hidden)']);
});

test('profiles a Parquet file and reports its declared types', async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(sample('sales-sample.parquet'));

  await expect(page.getByRole('heading', { name: 'sales-sample.parquet' })).toBeVisible();
  await expect(page.getByTestId('source-line')).toContainText('Parquet file · written by parquet-cpp-arrow');
  await expect(page.getByTestId('stat-rows')).toHaveText('1,378');
  await expect(page.getByTestId('stat-declared-types')).toHaveText('12 typed');
  await expect(page.getByRole('region', { name: 'Findings' })).toContainText(
    'Ship Date is before Order Date in 4 rows',
  );

  expect(errors).toEqual([]);
});

test('flags Parquet columns declared as text that hold dates or numbers', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(fixture('types.parquet'));

  await expect(page.getByTestId('note-declared-mismatch')).toContainText(
    '2 columns are declared as text but hold dates or numbers',
  );
  await expect(page.getByTestId('note-nested-columns')).toContainText('"tags" and "point" are shown as JSON text');
});

test('profiles JSON: finds the list of records and flattens nested objects', async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto('/');
  const records = Array.from({ length: 40 }, (_, i) => ({
    id: i + 1,
    seen: `2026-02-${String((i % 28) + 1).padStart(2, '0')}`,
    customer: { email: `person${i}@example.com`, tags: ['new'] },
  }));
  await page.getByTestId('file-input').setInputFiles({
    name: 'api.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ page: 1, results: records })),
  });

  await expect(page.getByTestId('source-line')).toHaveText('JSON file · records under "results"');
  await expect(page.getByTestId('stat-rows')).toHaveText('40');
  await expect(page.getByTestId('stat-structure')).toHaveText('Nested');
  await expect(page.getByTestId('note-nested-objects')).toContainText('"customer.email"');
  await expect(page.getByTestId('column-customer.email')).toContainText('Personal data');
  await expect(page.getByTestId('grain')).toHaveText('Each row is one id.');

  expect(errors).toEqual([]);
});

test('explains files it cannot read instead of failing', async ({ page }) => {
  await page.goto('/');
  const input = page.getByTestId('file-input');

  await input.setInputFiles({
    name: 'old.xls',
    mimeType: 'application/vnd.ms-excel',
    buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3, 4]),
  });
  await expect(page.getByRole('alert')).toContainText('older Excel file (.xls) or a password-protected workbook');
  await expect(page.getByRole('button', { name: 'Skip broken rows and continue' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Choose another file' }).click();
  await page.getByTestId('file-input').setInputFiles({
    name: 'config.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"name": "settings", "debug": true}'),
  });
  await expect(page.getByRole('alert')).toContainText('No list of records was found');
});
