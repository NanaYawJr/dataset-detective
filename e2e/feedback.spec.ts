import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SAMPLE = fileURLToPath(new URL('../samples/sales-sample.xlsx', import.meta.url));

/** Stands in for the server's feedback endpoint, recording what was sent. */
async function fakeFeedbackServer(page: Page) {
  const sent: Record<string, unknown>[] = [];
  await page.route('**/api/feedback', async (route) => {
    sent.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ status: 204 });
  });
  return sent;
}

test('sends a rating and comment, with nothing about the file but its type', async ({ page }) => {
  const sent = await fakeFeedbackServer(page);
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(SAMPLE);
  await expect(page.getByRole('heading', { name: 'sales-sample.xlsx' })).toBeVisible();

  await page.getByRole('complementary', { name: 'Feedback' }).getByRole('button', { name: 'Give feedback' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Was this useful?' })).toBeVisible();
  await expect(dialog).toContainText('and file type (Excel). Never your file, its name or its contents.');

  // The rating is the only required answer.
  await dialog.getByRole('button', { name: 'Send feedback' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Choose a rating first');
  expect(sent).toHaveLength(0);

  // The question follows the rating.
  await dialog.getByText('2', { exact: true }).click();
  await expect(dialog.getByText('What went wrong?')).toBeVisible();
  await dialog.getByText('5', { exact: true }).click();
  await expect(dialog.getByText('What did you find most useful?')).toBeVisible();
  await dialog.getByRole('textbox').fill('The Fix it scripts saved me an hour.');

  // Contact fields stay hidden unless a reply is wanted.
  await expect(dialog.getByTestId('feedback-contact')).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Send feedback' }).click();
  await expect(dialog.getByTestId('feedback-thanks')).toContainText('You rated it 5 out of 5.');
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({
    rating: 5,
    comment: 'The Fix it scripts saved me an hour.',
    wants_reply: false,
    file_kind: 'excel',
    website: '',
  });
  expect(sent[0]).not.toHaveProperty('email');
  expect(JSON.stringify(sent[0])).not.toContain('sales-sample');
});

test('asks for an email only when a reply is wanted', async ({ page }) => {
  const sent = await fakeFeedbackServer(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Feedback', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).not.toContainText('file type');

  await dialog.getByText('3', { exact: true }).click();
  await dialog.getByLabel("I'd like a reply about this").check();
  const contact = dialog.getByTestId('feedback-contact');
  await contact.getByLabel('Name (optional)').fill('Kofi');
  await contact.getByLabel('Country (optional)').selectOption('Canada');
  await dialog.getByRole('button', { name: 'Send feedback' }).click();
  await expect(contact.getByRole('alert')).toContainText('Enter an email so a reply can reach you');

  await contact.getByLabel('Email').fill('kofi@example.com');
  await dialog.getByRole('button', { name: 'Send feedback' }).click();
  await expect(dialog.getByTestId('feedback-thanks')).toContainText('Expect a reply by email.');
  expect(sent[0]).toMatchObject({
    rating: 3,
    wants_reply: true,
    name: 'Kofi',
    country: 'Canada',
    email: 'kofi@example.com',
    file_kind: '',
  });

  // Escape closes it, and the next time starts afresh.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Feedback', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Send feedback' })).toBeVisible();
});

test('shows feedback on the private page, with delete and download', async ({ page }) => {
  let entries = [
    {
      id: 2,
      created_at: '2026-11-17T09:30:00+00:00',
      rating: 2,
      comment: 'Excel dates looked odd.',
      wants_reply: true,
      name: 'Kofi',
      country: 'Canada',
      email: 'kofi@example.com',
      app_version: '0.7.0',
      file_kind: 'excel',
    },
    {
      id: 1,
      created_at: '2026-11-16T15:00:00+00:00',
      rating: 5,
      comment: '',
      wants_reply: false,
      name: '',
      country: '',
      email: '',
      app_version: '0.7.0',
      file_kind: 'delimited',
    },
  ];
  await page.route('**/api/stats', (route) =>
    route.fulfill({ json: { totals: { visits: 3, visitors: 2, profiles: 2, users: 2 }, formats: {}, days: [] } }),
  );
  await page.route('**/api/feedback**', async (route) => {
    if (route.request().headers().authorization !== 'Bearer open-sesame')
      return route.fulfill({ status: 401, json: { detail: 'Wrong password.' } });
    if (route.request().method() === 'DELETE') {
      const id = Number(route.request().url().split('/').pop());
      entries = entries.filter((entry) => entry.id !== id);
      return route.fulfill({ status: 204 });
    }
    const ratings = entries.map((e) => e.rating);
    return route.fulfill({
      json: {
        count: entries.length,
        average: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
        ratings: Object.fromEntries([1, 2, 3, 4, 5].map((r) => [String(r), ratings.filter((x) => x === r).length])),
        entries,
        retention_days: 365,
        alerts: true,
      },
    });
  });

  await page.goto('/#stats');
  await page.getByLabel('Password').fill('open-sesame');
  await page.getByRole('button', { name: 'Show usage' }).click();
  await page.getByRole('tab', { name: 'Feedback' }).click();

  await expect(page.getByTestId('feedback-count')).toHaveText('2');
  await expect(page.getByTestId('feedback-average')).toHaveText('3.5 / 5');
  const list = page.getByTestId('feedback-entries');
  await expect(list.getByRole('listitem').first()).toContainText('Excel dates looked odd.');
  await expect(list.getByRole('link', { name: 'kofi@example.com' })).toHaveAttribute(
    'href',
    /^mailto:kofi@example\.com/,
  );
  await expect(list.getByRole('listitem').nth(1)).toContainText('No comment.');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download CSV' }).click(),
  ]);
  const csv = readFileSync(await download.path(), 'utf8');
  expect(csv).toContain('Excel dates looked odd.');
  expect(csv.split('\r\n')).toHaveLength(4);

  await list.getByRole('listitem').first().getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('feedback-count')).toHaveText('1');
  await expect(list).not.toContainText('Excel dates looked odd.');
});
