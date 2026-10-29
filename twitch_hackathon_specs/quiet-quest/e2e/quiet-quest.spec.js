import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function axe(page) {
  const report = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
  const errors = report.violations.map((item) => ({ id: item.id, help: item.help, targets: item.nodes.map((node) => node.target) }));
  expect(errors, JSON.stringify(errors).slice(0, 2000)).toEqual([]);
}
async function studio(page) {
  await page.goto('/');
  await page.getByLabel('Operator passphrase').fill('quiet-quest-test-passphrase');
  await page.getByRole('button', { name: /Open studio/ }).click();
  await expect(page.getByRole('heading', { name: /Make room for/ })).toBeVisible();
  const reset = await page.evaluate(async () => { const response = await fetch('/api/test/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); return response.ok; });
  expect(reset).toBeTruthy(); await page.reload();
}

test('demo session: simulated chat and companion have equal agency, pause is honoured, recap stays aggregate', async ({ page, context }) => {
  await studio(page); await expectA11yLogin(page);
  await page.getByRole('button', { name: /Start demo round/ }).click();
  await expect(page.locator('#phase-badge')).toHaveText('Round open'); await axe(page);
  await page.getByRole('button', { name: /Simulate chat contribution/ }).click();
  await expect(page.locator('#goal-total')).toHaveText('1'); await expect(page.locator('#chat-count')).toContainText('1 contribution');
  const companionHref = await page.locator('#open-companion').getAttribute('href');
  const companion = await context.newPage(); await companion.goto(companionHref);
  await expect(companion.getByRole('heading', { name: /Help grow the shared garden/ })).toBeVisible();
  await expect(companion.getByRole('radio', { name: /Plant native flowers/ })).toBeVisible();
  await axe(companion);
  await companion.getByRole('radio', { name: /Plant native flowers/ }).check();
  await companion.getByRole('button', { name: /Add my contribution/ }).click();
  await expect(companion.getByRole('status')).toContainText(/Contribution recorded/); await axe(companion);
  await expect(page.locator('#goal-total')).toHaveText('2'); await expect(page.locator('#companion-count')).toContainText('1 contribution');

  const overlayHref = await page.locator('#open-overlay').getAttribute('href');
  const overlay = await context.newPage(); await overlay.goto(overlayHref);
  await expect(overlay.getByRole('heading', { name: /Build a community/ })).toBeVisible();
  await expect(overlay.locator('#overlay-count')).toHaveText('2 / 12');
  await expect(overlay.locator('#overlay-card')).not.toContainText('Sample participant'); await axe(overlay);
  const obs1280 = await overlay.locator('#overlay-card').evaluate((el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: innerWidth, height: innerHeight }; });
  expect(obs1280.left).toBeGreaterThanOrEqual(0); expect(obs1280.top).toBeGreaterThanOrEqual(0); expect(obs1280.right).toBeLessThanOrEqual(obs1280.width); expect(obs1280.bottom).toBeLessThanOrEqual(obs1280.height);
  await overlay.setViewportSize({ width: 390, height: 844 });
  const obsNarrow = await overlay.locator('#overlay-card').evaluate((el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: innerWidth, height: innerHeight }; });
  expect(obsNarrow.left).toBeGreaterThanOrEqual(0); expect(obsNarrow.top).toBeGreaterThanOrEqual(0); expect(obsNarrow.right).toBeLessThanOrEqual(obsNarrow.width); expect(obsNarrow.bottom).toBeLessThanOrEqual(obsNarrow.height);
  await overlay.setViewportSize({ width: 1280, height: 720 });

  await page.getByRole('button', { name: 'Pause round' }).click();
  await expect(page.locator('#phase-badge')).toHaveText('Game paused');
  await expect(companion.locator('#phase-pill')).toHaveText('Paused'); await axe(companion);
  await expect(overlay.locator('#overlay-state')).toHaveText('GAME PAUSED');
  await page.getByRole('button', { name: 'Resume round' }).click();
  await expect(page.locator('#phase-badge')).toHaveText('Round open');
  await page.getByRole('button', { name: 'Close round' }).click();
  await expect(page.locator('#result-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Start next round' }).click();
  await expect(page.locator('#round-number')).toHaveText('2'); await expect(page.locator('#goal-total')).toHaveText('0');

  await page.getByRole('button', { name: 'End session' }).click();
  await page.getByRole('button', { name: 'End session', exact: true }).last().click();
  await expect(page.locator('#phase-badge')).toHaveText('Session ended'); await axe(page); await axe(companion);
  const recap = await page.request.get('/api/recap'); const data = await recap.json();
  expect(data.sessions.map((item) => item.snapshot.round)).toEqual([1,2]);
  const csv = await page.request.get('/api/recap/export'); const text = await csv.text();
  expect(csv.ok()).toBeTruthy(); expect(text).toContain('"2"'); expect(text).not.toContain('sample-1');
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileStudio = await page.locator('body').evaluate((body) => ({ scroll: body.scrollWidth, viewport: innerWidth }));
  expect(mobileStudio.scroll).toBeLessThanOrEqual(mobileStudio.viewport); await axe(page);
});

async function expectA11yLogin(page) { await axe(page); }

test('companion invite is revocable; token survives reload and duplicate contribution is explained', async ({ page, context }) => {
  await studio(page); await page.getByRole('button', { name: /Start demo round/ }).click(); await expect(page.locator('#phase-badge')).toHaveText('Round open');
  const initialHref = await page.locator('#open-companion').getAttribute('href'); const oldCode = initialHref.split('#')[1];
  const manualContext = await context.browser().newContext(); const manual = await manualContext.newPage(); await manual.goto('/companion'); await axe(manual);
  await manual.getByRole('textbox', { name: 'Session code' }).fill('invalid-code'); await manual.getByRole('textbox', { name: 'Session code' }).press('Enter');
  await expect(manual.locator('#join-feedback')).toContainText(/invalid, expired, or disabled/); await axe(manual);
  await manual.getByRole('textbox', { name: 'Session code' }).fill(oldCode); await manual.getByRole('textbox', { name: 'Session code' }).press('Enter');
  await expect(manual.locator('#contribute-panel')).toBeVisible(); await axe(manual); await manualContext.close();
  const companion = await context.newPage(); await companion.goto(initialHref);
  await expect(companion.getByRole('heading', { name: /Help grow the shared garden/ })).toBeVisible(); await axe(companion);
  await companion.getByRole('radio', { name: /Plant native flowers/ }).check(); await companion.getByRole('button', { name: /Add my contribution/ }).click();
  await expect(companion.getByRole('status')).toContainText(/Contribution recorded/); await axe(companion);
  await companion.reload(); await expect(companion.locator('#contribution-feedback')).toContainText(/already contributed/);
  await expect(companion.getByRole('button', { name: /Add my contribution/ })).toBeDisabled(); await axe(companion);
  await companion.getByRole('radio', { name: /Plant native flowers/ }).check();
  await companion.locator('#contribute-button').evaluate((button) => { button.disabled = false; });
  await companion.getByRole('button', { name: /Add my contribution/ }).click();
  await expect(companion.locator('#contribution-feedback')).toContainText(/already contributed this round/); await axe(companion);
  await page.getByRole('button', { name: 'New code' }).click();
  await expect(page.locator('#companion-code')).not.toHaveText(oldCode);
  const freshHref = await page.locator('#open-companion').getAttribute('href'); expect(freshHref).not.toContain(oldCode);
  const staleContext = await context.browser().newContext(); const stale = await staleContext.newPage(); await stale.goto(`/companion#${oldCode}`);
  await expect(stale.getByRole('status')).toContainText(/invalid, expired, or disabled/); await axe(stale); await staleContext.close();
  await page.getByRole('button', { name: 'End session' }).click(); await page.getByRole('button', { name: 'End session', exact: true }).last().click();
  await expect(companion.locator('#round-status')).toContainText(/session has ended/); await axe(companion);
});

test('keyboard-first narrow companion view has labelled controls and no horizontal overflow', async ({ page }) => {
  await studio(page); await page.getByRole('button', { name: /Start demo round/ }).click(); await expect(page.locator('#phase-badge')).toHaveText('Round open');
  const href = await page.locator('#open-companion').getAttribute('href');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 760 });
  let blockedSse = 0; await page.route('**/api/companion/events', (route) => { blockedSse++; return blockedSse === 1 ? route.abort() : route.continue(); }); await page.goto(href); await expect(page.locator('#contribute-panel')).toBeVisible();
  const dimensions = await page.locator('body').evaluate((body) => ({ scroll: body.scrollWidth, viewport: innerWidth, transition: getComputedStyle(document.querySelector('.button')).transitionDuration }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.viewport);
  expect(parseFloat(dimensions.transition)).toBeLessThanOrEqual(0.001);
  await axe(page);
  await page.setViewportSize({ width: 768, height: 900 });
  const tablet = await page.locator('body').evaluate((body) => ({ scroll: body.scrollWidth, viewport: innerWidth }));
  expect(tablet.scroll).toBeLessThanOrEqual(tablet.viewport); await axe(page);
  await expect(page.locator('#connection-feedback')).toContainText(/connection interrupted/); await axe(page);
  await expect(page.locator('#connection-feedback')).toContainText(/updates restored/, { timeout: 12_000 }); expect(blockedSse).toBeGreaterThanOrEqual(2);
  await page.keyboard.press('Tab'); await expect(page.locator(':focus')).toBeVisible();
  await page.getByRole('radio', { name: /Set out a water station/ }).focus(); await page.keyboard.press('Space');
  await expect(page.getByRole('radio', { name: /Set out a water station/ })).toBeChecked();
  await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: /Add my contribution/ })).toBeFocused();
  await page.route('**/api/companion/contribute', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Temporary test interruption' } }) })); await page.keyboard.press('Enter');
  await expect(page.locator('#contribution-feedback')).toContainText(/Temporary test interruption/);
  await expect(page.getByRole('radio', { name: /Set out a water station/ })).toBeChecked(); await axe(page);
  await page.unroute('**/api/companion/contribute'); await page.getByRole('button', { name: /Add my contribution/ }).focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#contribution-feedback')).toContainText(/Contribution recorded/); await axe(page);
});

test('live mode fails closed without auth; anonymous/overlay routes cannot operate the session', async ({ page, request }) => {
  await page.goto('/');
  const unauthorized = await request.post('/api/sessions', { data: { mode: 'demo' } }); expect(unauthorized.status()).toBe(403); // same-origin is absent
  await page.getByLabel('Operator passphrase').fill('quiet-quest-test-passphrase'); await page.getByRole('button', { name: /Open studio/ }).click();
  const status = await page.request.get('/api/studio'); const config = await status.json(); expect(config.twitch.oauthReady).toBe(false);
  await expect(page.locator('#start-live')).toBeDisabled();
  const callback = await page.request.get('/auth/twitch/callback?error=access_denied&state=invalid');
  expect(callback.status()).toBe(400); expect(callback.headers()['set-cookie']).toContain('qq_oauth_state='); expect(callback.headers()['set-cookie']).toContain('Max-Age=0');
  const badInvite = await page.request.post('/api/companion/join', { data: { code: 'not-a-valid-code' }, headers: { Origin: 'http://evil.example' } }); expect(badInvite.status()).toBe(403);
  const health = await page.request.get('/api/health'); expect(health.ok()).toBeTruthy();
});
