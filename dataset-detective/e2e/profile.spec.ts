import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const SAMPLE = fileURLToPath(new URL('../samples/sales-sample.csv', import.meta.url));

/** Collects console errors and security-policy violations during a test. */
function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test('profiles the golden sample in the browser under the security policy', async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(SAMPLE);

  await expect(page.getByRole('heading', { name: 'sales-sample.csv' })).toBeVisible();
  await expect(page.getByTestId('stat-rows')).toHaveText('1,378');
  await expect(page.getByTestId('stat-columns')).toHaveText('12');
  await expect(page.getByTestId('stat-delimiter')).toHaveText('comma');
  await expect(page.getByTestId('stat-encoding')).toHaveText('UTF-8');

  // Order ID repeats: 800 distinct values across 1,378 rows.
  const orderId = page.getByRole('row', { name: /^Order ID/ });
  await expect(orderId).toContainText('800');

  // The placeholder priority is the most common value: 300 rows.
  const priority = page.getByRole('row', { name: /^Order Priority/ });
  await expect(priority).toContainText('4-Not Specified');
  await expect(priority).toContainText('300');

  // Dates are kept exactly as written, so their shape is visible.
  await expect(page.getByRole('row', { name: /^Order Date/ })).toContainText('99/99/9999');

  expect(errors).toEqual([]);
});

test('stops on broken rows, explains them, and can skip them', async ({ page }) => {
  await page.goto('/');
  const csv = ['id,name,amount', '1,Ann,10', '2,Ben,20,extra', '3,Cal', '4,Dee,40', ''].join('\n');
  await page
    .getByTestId('file-input')
    .setInputFiles({ name: 'broken.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });

  await expect(page.getByRole('heading', { name: "This file can't be read cleanly yet" })).toBeVisible();
  await expect(page.getByText('2 rows have the wrong number of columns')).toBeVisible();
  await expect(page.getByText('lines 3 and 4')).toBeVisible();

  await page.getByRole('button', { name: 'Skip broken rows and continue' }).click();
  await expect(page.getByTestId('stat-rows')).toHaveText('2');
  await expect(page.getByText('2 broken rows skipped').first()).toBeVisible();
});

test('reads a Windows-1252 file without garbling accented letters', async ({ page }) => {
  await page.goto('/');
  // "Café" and "Zoë" with single-byte accented letters, as Excel on Windows saves them.
  const bytes = Buffer.from([
    ...Buffer.from('id,shop\n1,Caf'),
    0xe9,
    ...Buffer.from('\n2,Zo'),
    0xeb,
    ...Buffer.from('\n'),
  ]);
  await page.getByTestId('file-input').setInputFiles({ name: 'excel-export.csv', mimeType: 'text/csv', buffer: bytes });

  await expect(page.getByTestId('stat-encoding')).toHaveText('Windows-1252');
  await expect(page.getByRole('row', { name: /^shop/ })).toContainText('Café');
  await expect(page.getByRole('row', { name: /^shop/ })).toContainText('Zoë');
});

test('shows dates in the chosen region format', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Region').selectOption('CA');
  await page.getByTestId('file-input').setInputFiles(SAMPLE);
  await expect(page.getByText(/Profiled \d{4}-\d{2}-\d{2}/)).toBeVisible();

  // The choice is remembered on reload.
  await page.reload();
  await expect(page.getByLabel('Region')).toHaveValue('CA');
});
