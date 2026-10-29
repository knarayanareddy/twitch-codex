import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function expectAxeClean(page) {
  const report = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const summary = report.violations.map((item) => ({ id: item.id, help: item.help, nodes: item.nodes.map((node) => node.target) }));
  expect(summary, JSON.stringify(summary).slice(0, 2500)).toEqual([]);
}

async function signIn(page) {
  await page.goto('/');
  await page.getByLabel('Local access passphrase').fill('context-desk-demo-passphrase');
  await page.getByRole('button', { name: /Open the review desk/ }).click();
  await expect(page.getByRole('heading', { name: 'Review desk.' })).toBeVisible();
  await page.evaluate(async () => { const response = await fetch('/api/test/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); if (!response.ok) throw new Error('test state reset failed'); });
  await page.reload(); await expect(page.getByRole('heading', { name: 'Review desk.' })).toBeVisible();
}

test('90-second local journey: fixtures → evidence → review → publish → read-only overlay → recap', async ({ page }) => {
  await signIn(page);
  await expect(page.locator('#mode-badge')).toContainText('Local demo');
  await page.getByRole('button', { name: /Try the demo/ }).click();
  await expect(page.getByRole('button', { name: /Why is Pluto called a dwarf planet/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /How many moons does Saturn have right now/ })).toBeVisible();
  await page.getByRole('button', { name: /Why is Pluto called a dwarf planet/ }).click();

  const evidenceHeading = page.getByRole('heading', { name: /Evidence found/ });
  const draftHeading = page.getByRole('heading', { name: /Draft context/ });
  await expect(evidenceHeading).toBeVisible(); await expect(draftHeading).toBeVisible();
  const evidencePrecedesDraft = await page.locator('.evidence-section').evaluate((node) => Boolean(node.compareDocumentPosition(document.querySelector('.draft-section')) & Node.DOCUMENT_POSITION_FOLLOWING));
  expect(evidencePrecedesDraft).toBeTruthy();
  await expect(page.getByText('NASA Science', { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/no model used/i).first()).toBeVisible();
  await page.getByLabel(/Cite What is a Planet/).first().check();
  await expect(page.getByText('Exact broadcast preview')).toBeVisible();
  await expect(page.locator('.overlay-card .overlay-title')).toContainText('How astronomers define a planet');
  await page.getByLabel(/I reviewed the sources and exact preview/).check();
  await page.getByRole('button', { name: /Approve for overlay/ }).click();
  await expect(page.getByText(/Published\. The approved card/)).toBeVisible();

  const overlayHref = await page.getByRole('link', { name: /Overlay/ }).getAttribute('href');
  const response = await page.request.get(`/api/overlay/${new URL(overlayHref, 'http://127.0.0.1:4174').searchParams.get('session')}`);
  expect(response.ok()).toBeTruthy();
  const snapshot = await response.json();
  expect(snapshot.card.title).toBe('How astronomers define a planet');
  expect(JSON.stringify(snapshot)).not.toContain('Why is Pluto called a dwarf planet?');

  const overlay = await page.context().newPage(); await overlay.goto(overlayHref);
  await expect(overlay.getByRole('heading', { name: 'How astronomers define a planet' })).toBeVisible();
  await expect(overlay.getByRole('link', { name: /What is a Planet/ })).toBeVisible();
  await expect(overlay.locator('.overlay-card')).toContainText('Broadcaster reviewed');

  await page.getByRole('button', { name: /Published & recap/ }).click();
  await expect(page.getByRole('heading', { name: 'Published & recap.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'How astronomers define a planet' })).toBeVisible();
  const exportResponse = await page.request.get('/api/recap/export');
  expect(exportResponse.ok()).toBeTruthy();
  const exportText = await exportResponse.text();
  expect(exportText).toContain('What is a Planet?');
  expect(exportText).not.toContain('Why is Pluto called a dwarf planet?');
  await expectAxeClean(page);
});

test('insufficient-evidence fixture has no publish control and overlay stays empty', async ({ page }) => {
  await signIn(page); await page.getByRole('button', { name: /Try the demo/ }).click();
  await page.getByRole('button', { name: /How many moons does Saturn have right now/ }).click();
  await expect(page.getByText('No safe draft this time.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Approve for overlay/ })).toHaveCount(0);
  await expectAxeClean(page);
  const config = await page.request.get('/api/config'); const data = await config.json();
  const key = data.session;
  const snapshot = await page.request.get(`/api/overlay/${key}`);
  expect((await snapshot.json()).card).toBeNull();
});

test('unauthenticated mutation is refused; overlay URL offers no mutation action', async ({ page }) => {
  await page.goto('/');
  const queueResponse = await page.request.get('/api/review-queue');
  expect(queueResponse.status()).toBe(401);
  const health = await page.request.get('/api/health'); expect(health.status()).toBe(200);
  const html = await page.locator('body').innerText(); expect(html).not.toContain('Client secret');
});

test('mobile layout and reviewer page pass automated axe checks', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page); await expectAxeClean(page); await page.getByRole('button', { name: /Try the demo/ }).click();
  await page.getByRole('button', { name: /Why is Pluto called a dwarf planet/ }).click();
  await expect(page.getByRole('button', { name: /Approve for overlay/ })).toBeVisible();
  await expectAxeClean(page);
  const width = await page.locator('body').evaluate((element) => ({ body: element.scrollWidth, viewport: innerWidth }));
  expect(width.body).toBeLessThanOrEqual(width.viewport);
});

test('anonymous viewer vote is one-per-token, fixed-choice, and only queues a suggestion', async ({ page, browser }) => {
  await signIn(page);
  const config = await page.request.get('/api/config'); const { session } = await config.json();
  const viewerContext = await browser.newContext(); const viewer = await viewerContext.newPage();
  await viewer.goto(`/vote?session=${session}`);
  await expect(viewer.getByRole('heading', { name: /What should we look into next/ })).toBeVisible();
  await expect(viewer.locator('input[type="radio"]')).toHaveCount(3);
  await expectAxeClean(viewer);
  await viewer.getByRole('radio', { name: /Why is Pluto classified as a dwarf planet/ }).check();
  await viewer.getByRole('button', { name: /Cast my vote/ }).click();
  await expect(viewer.getByRole('status')).toContainText(/Thank you\. Your vote is counted/);
  await viewer.reload();
  await expect(viewer.getByRole('status')).toContainText(/Your vote is counted/);
  await expect(viewer.getByRole('button', { name: /Vote already counted/ })).toBeDisabled();
  await expectAxeClean(viewer);

  await page.getByRole('button', { name: 'Setup' }).click();
  await expect(page.locator('#vote-admin-message')).toContainText('1 anonymous vote');
  await page.getByRole('button', { name: /Queue winning topic for review/ }).click();
  await expect(page.locator('#review-content')).toContainText('Needs human review');
  await expect(page.locator('#review-content')).toContainText('VIEWER POLL');
  const overlaySnapshot = await page.request.get(`/api/overlay/${session}`);
  expect((await overlaySnapshot.json()).card).toBeNull();
  await viewerContext.close();
});

test('approved card fits the read-only overlay at 1280×720 and 1920×1080', async ({ page }) => {
  await signIn(page); await page.getByRole('button', { name: /Try the demo/ }).click();
  await page.getByRole('button', { name: /Why is Pluto called a dwarf planet/ }).click();
  await page.getByLabel(/Cite What is a Planet/).first().check();
  await page.getByLabel(/I reviewed the sources and exact preview/).check();
  await page.getByRole('button', { name: /Approve for overlay/ }).click();
  await expect(page.getByText(/Published\. The approved card/)).toBeVisible();
  const href = await page.getByRole('link', { name: /Overlay/ }).getAttribute('href');
  const overlay = await page.context().newPage(); await overlay.goto(href);
  await expect(overlay.getByRole('heading', { name: 'How astronomers define a planet' })).toBeVisible();
  for (const [width, height] of [[1280, 720], [1920, 1080]]) {
    await overlay.setViewportSize({ width, height });
    const bounds = await overlay.locator('.overlay-card').evaluate((node) => { const rect = node.getBoundingClientRect(); return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }; });
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(width); expect(bounds.bottom).toBeLessThanOrEqual(height);
    expect(bounds.width).toBeGreaterThan(0); expect(bounds.height).toBeGreaterThan(0);
  }
});

test('broadcaster cancellation appears in history with its audit trail and no publish path', async ({ page }) => {
  await signIn(page);
  const question = 'How do comets form a visible tail near the Sun?';
  await page.getByLabel('Add a question').fill(question);
  await page.getByRole('button', { name: /Add to queue/ }).click();
  await expect(page.locator('#review-content')).toContainText('Draft context');
  await page.getByRole('button', { name: 'Cancel item' }).click();
  await page.getByLabel('Reason').selectOption('not-relevant');
  await page.getByRole('button', { name: 'Save decision' }).click();
  await expect(page.getByText(/Review item cancelled/)).toBeVisible();
  await page.getByRole('button', { name: 'History' }).click();
  await page.getByRole('button', { name: new RegExp(question) }).click();
  await expect(page.locator('#review-content')).toContainText('Cancelled');
  await expect(page.locator('.audit-list')).toContainText(/cancelled.*broadcaster/i);
  await expect(page.getByRole('button', { name: /Approve for overlay/ })).toHaveCount(0);
  const config = await page.request.get('/api/config'); const { session } = await config.json();
  expect((await (await page.request.get(`/api/overlay/${session}`)).json()).card).toBeNull();
});
