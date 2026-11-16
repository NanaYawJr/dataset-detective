import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const sample = (name: string) => fileURLToPath(new URL(`../samples/${name}`, import.meta.url));

function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test('compares the sample with its earlier delivery', async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(sample('sales-sample.csv'));
  await expect(page.getByRole('heading', { name: 'sales-sample.csv' })).toBeVisible();

  const panel = page.getByRole('region', { name: 'Compare with an earlier version' });
  await panel.getByTestId('compare-input').setInputFiles(sample('sales-sample-previous.csv'));

  await expect(panel.getByTestId('compare-headline')).toHaveText(
    '132 more rows (1,246 → 1,378), 2 column changes, changes inside 5 columns.',
  );
  const structure = panel.getByTestId('structure-changes');
  await expect(structure).toContainText('New: Customer Email');
  await expect(structure).toContainText('Renamed: Customer_Segment is now Customer Segment.');

  const columns = panel.getByTestId('column-changes');
  await expect(columns).toContainText('A new value: "4-Not Specified"');
  await expect(columns).toContainText('A value no longer appears: "Mail"');
  await expect(columns).toContainText('Now runs to 31 Dec 2025');
  // The placeholder counts as missing, so a column that had no gaps now has them.
  await expect(columns).toContainText('Now has missing values: 22% of rows. It had none.');
  await expect(columns).toContainText('The average fell 16%');

  await expect(panel.getByTestId('findings-new')).toContainText('Order Priority');
  // Order ID repeats (several lines per order), so rows can't be matched one to one.
  await expect(panel.getByTestId('no-row-match')).toContainText('Rows could not be matched');

  await panel.getByRole('button', { name: 'Stop comparing' }).click();
  await expect(panel.getByRole('button', { name: 'Choose the earlier file' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('matches rows on a key and reports which were added, removed and edited', async ({ page }) => {
  await page.goto('/');
  const csv = (rows: string[]) => Buffer.from(['Ticket,Status,Minutes', ...rows, ''].join('\n'));
  const base = Array.from({ length: 30 }, (_, i) => `T${100 + i},${i % 2 ? 'Open' : 'Closed'},${10 + i}`);
  const now = [...base.slice(2), 'T130,Open,5', 'T131,Open,6'].map((row) =>
    row.startsWith('T105,') ? 'T105,Closed,99' : row,
  );

  await page
    .getByTestId('file-input')
    .setInputFiles({ name: 'tickets-nov.csv', mimeType: 'text/csv', buffer: csv(now) });
  await expect(page.getByTestId('grain')).toHaveText('Each row is one Ticket.');

  const panel = page.getByRole('region', { name: 'Compare with an earlier version' });
  await panel
    .getByTestId('compare-input')
    .setInputFiles({ name: 'tickets-oct.csv', mimeType: 'text/csv', buffer: csv(base) });

  await expect(panel.getByTestId('rows-added-removed')).toHaveText('+2 / −2');
  await expect(panel.getByTestId('rows-changed')).toHaveText('1');
  const examples = panel.getByTestId('row-examples');
  await expect(examples).toContainText('New: 2 rows, such as T130, T131');
  await expect(examples).toContainText('Gone: 2 rows, such as T100, T101');
  await expect(examples).toContainText('Status in 1 row, Minutes in 1 row. For example T105 (Status, Minutes).');
});

test('explains an earlier file it cannot read, and a new file clears the comparison', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(sample('sales-sample.csv'));
  const panel = page.getByRole('region', { name: 'Compare with an earlier version' });

  await panel.getByTestId('compare-input').setInputFiles({
    name: 'old.xls',
    mimeType: 'application/vnd.ms-excel',
    buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3, 4]),
  });
  await expect(panel.getByRole('alert')).toContainText('older Excel file (.xls)');

  await panel.getByTestId('compare-input').setInputFiles(sample('sales-sample-previous.csv'));
  await expect(panel.getByTestId('compare-headline')).toBeVisible();

  await page.getByRole('button', { name: 'Profile another file' }).click();
  await page.getByTestId('file-input').setInputFiles(sample('sales-sample.parquet'));
  await expect(page.getByRole('heading', { name: 'sales-sample.parquet' })).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Compare with an earlier version' })
      .getByRole('button', { name: 'Choose the earlier file' }),
  ).toBeVisible();
});
