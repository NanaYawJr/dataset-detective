import { expect, test, type Page, type Route } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const sample = (name: string) => fileURLToPath(new URL(`../samples/${name}`, import.meta.url));

const ANSWER = [
  'The file is usable for most reporting, but a few columns need tidying first.',
  '',
  'What to fix first:',
  '- Order Priority: 300 rows use "4-Not Specified" as a placeholder.',
  '- Ship Date is before Order Date in 4 rows.',
  '',
  'Good to know:',
  '- Dates are day-first.',
].join('\n');

interface Sent {
  summary: Record<string, unknown>;
  provider?: string;
  api_key?: string;
}

/** Stands in for the site's server: the status, and the explanation itself. */
async function fakeServer(page: Page, status = { enabled: true, available: true, remaining: 5, own_key: true }) {
  const sent: Sent[] = [];
  await page.route('**/api/explain', async (route: Route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: status });
    const body = route.request().postDataJSON() as Sent;
    sent.push(body);
    if (body.api_key === 'sk-wrong')
      return route.fulfill({ status: 401, json: { detail: 'The API key was not accepted.' } });
    return route.fulfill({ json: { text: ANSWER, provider: body.provider ?? 'anthropic' } });
  });
  return sent;
}

test('explains the report from a summary that holds no values', async ({ page }) => {
  const sent = await fakeServer(page);
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(sample('sales-sample.csv'));
  const panel = page.getByRole('region', { name: 'Explain in plain English' });

  await panel.getByText('See exactly what will be sent').click();
  await expect(panel.getByTestId('explain-payload')).toContainText('"name": "Order Priority"');
  await expect(panel.getByText('Use a free explanation (5 left today)')).toBeVisible();

  await panel.getByRole('button', { name: 'Explain this report' }).click();
  const explanation = panel.getByTestId('explanation');
  await expect(explanation.getByRole('heading', { name: 'What to fix first' })).toBeVisible();
  await expect(explanation.getByRole('listitem').first()).toContainText('Order Priority');
  await expect(explanation).toContainText('Written by Claude');

  // What actually went to the server: the shape of the data, none of its contents.
  expect(sent).toHaveLength(1);
  const payload = JSON.stringify(sent[0]);
  expect(sent[0].api_key).toBeUndefined();
  for (const value of ['customer313@example.com', 'London', '28/01/2025', '24.66', '4-Not Specified', 'Regular Air']) {
    expect(payload).not.toContain(value);
  }
  expect(payload).toContain('Order Priority');
});

test('uses a visitor’s own key when chosen, and shows a rejected key plainly', async ({ page }) => {
  const sent = await fakeServer(page);
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(sample('sales-sample.csv'));
  const panel = page.getByRole('region', { name: 'Explain in plain English' });

  await panel.getByLabel('Use my own API key').check();
  const button = panel.getByRole('button', { name: 'Explain this report' });
  await expect(button).toBeDisabled();

  await panel.getByLabel('Provider').selectOption('openai');
  await panel.getByLabel('API key', { exact: true }).fill('sk-wrong');
  await button.click();
  await expect(panel.getByRole('alert')).toHaveText('The API key was not accepted.');

  await panel.getByLabel('API key', { exact: true }).fill('sk-visitor-key');
  await button.click();
  await expect(panel.getByTestId('explanation')).toContainText('Written by OpenAI');
  expect(sent.at(-1)).toMatchObject({ provider: 'openai', api_key: 'sk-visitor-key' });

  // The key is never written into the page's storage.
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  expect(stored).not.toContain('sk-visitor-key');
});

test('says when the free explanations are used up, and when the report has changed since', async ({ page }) => {
  await fakeServer(page, { enabled: true, available: false, remaining: 0, own_key: true });
  await page.goto('/');
  await page.getByLabel('Region').selectOption('CA');
  const csv = ['visit,amount', '03/04/2026,10', '05/06/2026,20', '07/08/2026,30', ''].join('\n');
  await page
    .getByTestId('file-input')
    .setInputFiles({ name: 'visits.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  const panel = page.getByRole('region', { name: 'Explain in plain English' });

  await expect(panel.getByText('No free explanations left today')).toBeVisible();
  await panel.getByLabel('API key', { exact: true }).fill('sk-visitor-key');
  await panel.getByRole('button', { name: 'Explain this report' }).click();
  await expect(panel.getByTestId('explanation')).toBeVisible();
  await expect(panel.getByTestId('explanation-stale')).toHaveCount(0);

  // A correction changes the report, so the explanation is marked as out of date.
  const visit = page.getByTestId('column-visit');
  await visit.getByText('Correct this').click();
  await visit.getByLabel('Date order').selectOption('month-first');
  await expect(panel.getByTestId('explanation-stale')).toBeVisible();
});

test('stays out of the way when explanations are switched off', async ({ page }) => {
  await fakeServer(page, { enabled: false, available: false, remaining: 0, own_key: false });
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(sample('sales-sample.csv'));
  await expect(page.getByRole('region', { name: 'Fix it' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Explain in plain English' })).toHaveCount(0);
});
