import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const SAMPLE = fileURLToPath(new URL('../samples/sales-sample.csv', import.meta.url));

/** Every usage signal the page sends, with its body. */
function watchSignals(page: Page): string[] {
  const bodies: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/event') bodies.push(request.postData() ?? '');
  });
  return bodies;
}

/** Every other request to the server: there should be none that carries a body, unless the visitor asks for an explanation. */
function watchOtherApiCalls(page: Page): { method: string; path: string; body: string | null }[] {
  const calls: { method: string; path: string; body: string | null }[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/') && path !== '/api/event')
      calls.push({ method: request.method(), path, body: request.postData() });
  });
  return calls;
}

test('tells the server only that it was opened and that a file was profiled', async ({ page }) => {
  const signals = watchSignals(page);
  const others = watchOtherApiCalls(page);
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(SAMPLE);
  await expect(page.getByRole('heading', { name: 'sales-sample.csv' })).toBeVisible();

  // Exactly two signals, and nothing in them about the file: no name, size, columns or values.
  await expect.poll(() => signals).toEqual(['{"type":"visit"}', '{"type":"profile","kind":"delimited"}']);

  // Changing how the same file is read is not another file.
  await page.getByLabel('Region').selectOption('US');
  await expect(page.getByTestId('column-Order Date')).toBeVisible();
  expect(signals).toHaveLength(2);

  // The only other call is the explanation panel asking whether explanations are available: a GET with no body.
  expect(others.every((call) => call.method === 'GET' && call.path === '/api/explain' && call.body === null)).toBe(
    true,
  );
});

test('keeps the usage page behind the password', async ({ page }) => {
  const signals = watchSignals(page);
  await page.route('**/api/stats', async (route) => {
    const allowed = route.request().headers().authorization === 'Bearer open-sesame';
    await route.fulfill(
      allowed
        ? {
            json: {
              totals: { visits: 1410, visitors: 1204, profiles: 2311, users: 987 },
              formats: { delimited: 1500, excel: 700, parquet: 61, json: 50 },
              days: [
                {
                  day: '2026-11-17',
                  visits: 40,
                  visitors: 31,
                  profiles: 52,
                  users: 22,
                  kinds: { excel: 30, delimited: 22 },
                },
                { day: '2026-11-16', visits: 12, visitors: 9, profiles: 8, users: 5, kinds: { delimited: 8 } },
              ],
            },
          }
        : { status: 401, json: { detail: 'Wrong password.' } },
    );
  });

  await page.goto('/#stats');
  await expect(page.getByRole('heading', { name: 'Usage' })).toBeVisible();
  await expect(page.getByTestId('total-users')).toHaveCount(0);

  await page.getByLabel('Password').fill('guess');
  await page.getByRole('button', { name: 'Show usage' }).click();
  await expect(page.getByRole('alert')).toHaveText('Wrong password.');

  await page.getByLabel('Password').fill('open-sesame');
  await page.getByRole('button', { name: 'Show usage' }).click();
  await expect(page.getByTestId('total-users')).toHaveText('987');
  await expect(page.getByTestId('total-profiles')).toHaveText('2,311');
  await expect(page.getByTestId('day-2026-11-17')).toContainText('17 Nov 2026');
  await expect(page.getByTestId('day-2026-11-17')).toContainText('22 CSV / text · 30 Excel');

  // Looking at the numbers is not a visit, so it isn't counted as one.
  expect(signals.filter((body) => body.includes('visit'))).toEqual([]);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByLabel('Password')).toBeVisible();
});
