import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SAMPLE = fileURLToPath(new URL('../samples/sales-sample.csv', import.meta.url));

test('writes a cleaning script in three languages from the profile', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(SAMPLE);

  const panel = page.getByRole('region', { name: 'Fix it' });
  await expect(panel.getByTestId('fix-summary')).toContainText('"5%" becomes 0.05');
  await expect(panel.getByTestId('fix-summary')).toContainText('Split City | Region into City and Region.');

  const code = panel.getByTestId('fix-code');
  await expect(code).toContainText('{"Order Date", each ToDate(_, "en-GB"), type nullable date}');

  await panel.getByRole('tab', { name: 'T-SQL' }).click();
  await expect(code).toContainText('TRY_CONVERT(date, c.[Order Date], 103) AS [Order Date]');

  await panel.getByRole('tab', { name: 'pandas' }).click();
  await expect(code).toContainText('df["Order Date"] = to_date(df["Order Date"], "day-first")');

  // Copy puts the whole script on the clipboard.
  await panel.getByRole('button', { name: 'Copy' }).click();
  await expect(panel.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('import pandas as pd');

  // Download saves it under a name made from the file's.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    panel.getByRole('button', { name: 'Download clean_sales_sample.py' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('clean_sales_sample.py');
  expect(readFileSync(await download.path(), 'utf8')).toContain('df.to_csv("sales_sample_clean.csv", index=False)');

  expect(errors).toEqual([]);
});

test('follows a correction: choosing a date order puts the conversion in the script', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Region').selectOption('CA');
  const csv = ['visit,amount', '03/04/2026,10', '05/06/2026,20', '07/08/2026,30', ''].join('\n');
  await page
    .getByTestId('file-input')
    .setInputFiles({ name: 'visits.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });

  const panel = page.getByRole('region', { name: 'Fix it' });
  // Nothing proves the order, so the script says it leaves the column as text rather than guessing.
  await expect(panel.getByTestId('fix-left-alone')).toContainText('visit stays as text');
  await expect(panel.getByTestId('fix-code')).not.toContainText('ToDate(_, "en-US")');

  const visit = page.getByTestId('column-visit');
  await visit.getByText('Correct this').click();
  await visit.getByLabel('Date order').selectOption('month-first');

  await expect(panel.getByTestId('fix-summary')).toContainText('Read visit as month-first dates.');
  await expect(panel.getByTestId('fix-code')).toContainText('{"visit", each ToDate(_, "en-US"), type nullable date}');
  await expect(panel.getByTestId('fix-left-alone')).toHaveCount(0);
});
