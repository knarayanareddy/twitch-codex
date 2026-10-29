import { test, expect } from '@playwright/test';

async function studio(page) {
  await page.goto('/'); await page.getByLabel('Operator passphrase').fill('quiet-quest-test-passphrase');
  await page.getByRole('button', { name: /Open studio/ }).click(); await expect(page.getByRole('heading', { name: /Make room for/ })).toBeVisible();
  const reset = await page.evaluate(async () => (await fetch('/api/test/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).ok);
  expect(reset).toBeTruthy(); await page.reload();
}

test('confirmed reset closes the previous session, clears the new round, rotates the invite, and preserves aggregate recap', async ({ page, context }) => {
  await studio(page); await page.getByRole('button', { name: /Start demo round/ }).click();
  await page.getByRole('button', { name: /Simulate chat contribution/ }).click(); await expect(page.locator('#goal-total')).toHaveText('1');
  const oldCompanion = await page.locator('#open-companion').getAttribute('href'); const oldCode = oldCompanion.split('#')[1];
  const participant = await context.newPage(); await participant.goto(oldCompanion); await expect(participant.locator('#contribute-panel')).toBeVisible();
  const oldOverlay = await page.locator('#open-overlay').getAttribute('href'); const oldSession = new URL(oldOverlay, 'http://localhost').searchParams.get('session');
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(page.getByRole('dialog')).toBeVisible(); await expect(page.getByRole('heading', { name: 'Reset this session?' })).toBeVisible();
  await page.getByRole('button', { name: 'Reset session' }).click();
  await expect(page.locator('#phase-badge')).toHaveText('Round open'); await expect(page.locator('#goal-total')).toHaveText('0');
  const newCompanion = await page.locator('#open-companion').getAttribute('href'); const newCode = newCompanion.split('#')[1];
  const newOverlay = await page.locator('#open-overlay').getAttribute('href'); const newSession = new URL(newOverlay, 'http://localhost').searchParams.get('session');
  expect(newSession).not.toBe(oldSession); expect(newCode).not.toBe(oldCode);
  await expect(page.locator('#recap-list')).toContainText('Round 1 · Demo simulation');
  await participant.reload(); await expect(participant.locator('#join-feedback')).toContainText(/session has ended or is unavailable/);
  const staleContext = await context.browser().newContext(); const stale = await staleContext.newPage(); await stale.goto(`/companion#${oldCode}`);
  await expect(stale.locator('#join-feedback')).toContainText(/invalid, expired, or disabled/); await staleContext.close();
  const recap = await page.request.get('/api/recap'); const data = await recap.json();
  expect(data.sessions.map((item) => item.snapshot.phase)).toContain('closed');
  expect(JSON.stringify(data)).not.toContain('sample-1');
});

test('companion join rate limit is enforced without creating a participant identity', async ({ page }) => {
  await studio(page); await page.getByRole('button', { name: /Start demo round/ }).click();
  const statuses = await page.evaluate(async () => {
    const output = [];
    for (let i = 0; i < 36; i++) {
      const response = await fetch('/api/companion/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'invalid-code' }) });
      output.push(response.status);
    }
    return output;
  });
  expect(statuses.slice(0, 35).every((status) => status === 404)).toBeTruthy(); expect(statuses[35]).toBe(429);
});
