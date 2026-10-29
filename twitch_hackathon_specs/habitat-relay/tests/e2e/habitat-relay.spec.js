import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';

const evidenceDir = new URL('../../docs/evidence/', import.meta.url);

async function resetSession(page) {
  const origin = 'http://127.0.0.1:4173';
  const response = await page.request.post(`${origin}/api/command`, {
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    data: { command: 'reset', payload: { mode: 'demo' } },
  });
  expect(response.ok()).toBeTruthy();
}

async function startDemo(page) {
  await page.getByRole('button', { name: /Try without Twitch/ }).click();
  await expect(page.getByRole('button', { name: 'Close round & review' })).toBeVisible();
}

async function closeAndApprove(page, choiceName) {
  await page.getByRole('button', { name: 'Close round & review' }).click();
  if (choiceName) await page.getByRole('button', { name: new RegExp(choiceName, 'i') }).click();
  await page.getByRole('button', { name: /Commit choice & continue/ }).click();
}

test.beforeEach(async ({ page }) => {
  await resetSession(page);
});

test('keyboard-accessible setup and studio pass axe WCAG 2.2 AA scan', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Give chat a hand/ })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toBeVisible();
  let results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  await page.getByRole('button', { name: /Try without Twitch/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Close round & review' })).toBeVisible();
  results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
});

test('complete three-round demo shows live tally, approval, optional action and both recap formats', async ({ page }) => {
  await page.goto('/');
  await startDemo(page);
  await page.getByRole('button', { name: 'Rehearse a tie' }).click();
  await expect(page.getByText(/Added 6 sample audience votes/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Plant native wildflower strips/ })).toContainText('50%');
  await closeAndApprove(page, 'Plant native wildflower strips');
  await expect(page.locator('#round-title')).toHaveText('Create safe shelter');
  await expect(page.locator('.resource-budget')).toContainText('4');
  await page.getByRole('button', { name: 'Add sample audience' }).click();
  await closeAndApprove(page);
  await expect(page.locator('#round-title')).toHaveText('Make the landscape work together');
  await page.getByRole('button', { name: 'Add sample audience' }).click();
  await page.getByRole('button', { name: 'Close round & review' }).click();
  await page.getByRole('button', { name: /Connect semi-natural habitat patches/ }).click();
  await page.getByRole('button', { name: /Commit choice & continue/ }).click();
  await expect(page.locator('#toast')).toContainText('not enough fictional field tokens');
  await page.getByRole('button', { name: /Add a wider mix of flowering periods/ }).click();
  await page.getByRole('button', { name: /Commit choice & continue/ }).click();
  await expect(page.getByRole('heading', { name: 'Field notes from this run' })).toBeVisible();
  await expect(page.getByText('OPTIONAL · OUTSIDE THE GAME')).toBeVisible();
  await expect(page.getByRole('link', { name: /Explore garden ideas from IVN/ })).toHaveAttribute('href', /\/action\/ivn-wildlife-friendly-garden/);
  const mdDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download Markdown recap' }).click();
  expect((await mdDownload).suggestedFilename()).toBe('habitat-relay-recap.md');
  const jsonDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download JSON recap' }).click();
  expect((await jsonDownload).suggestedFilename()).toBe('habitat-relay-recap.json');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
});

test('pause, resume, safe undo, discard, confirmation and session reset work in the studio', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto('/');
  await startDemo(page);
  await page.getByRole('button', { name: 'Pause session' }).click();
  await expect(page.locator('#round-title')).toHaveText('Make room for food');
  await expect(page.getByText(/round timer is frozen/)).toBeVisible();
  await page.getByRole('button', { name: 'Resume session' }).click();
  await page.getByRole('button', { name: 'Add sample audience' }).click();
  await closeAndApprove(page);
  await expect(page.getByRole('button', { name: 'Undo last committed choice' })).toBeVisible();
  await page.getByRole('button', { name: 'Undo last committed choice' }).click();
  await expect(page.getByText(/Audience plurality/i)).toBeVisible();
  await page.getByRole('button', { name: 'Discard round' }).click();
  await expect(page.locator('#round-title')).toHaveText('Create safe shelter');
  await page.getByRole('button', { name: 'Reset session' }).click();
  await expect(page.getByRole('heading', { name: /Give chat a hand/ })).toBeVisible();
  await expect(page.locator('.resource-budget')).toContainText('6');
});

test('session-only OBS overlay streams tallies, exposes sources and revokes on reset', async ({ page, browser }) => {
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto('/');
  await startDemo(page);
  await page.getByRole('button', { name: 'Add sample audience' }).click();
  const linkResponse = await page.request.get('/api/operator/overlay-link');
  const overlayLink = (await linkResponse.json()).url;
  const overlayContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const overlay = await overlayContext.newPage();
  await overlay.goto(overlayLink);
  await expect(overlay.getByText('DEMO DATA')).toBeVisible();
  await expect(overlay.getByText(/4 · 57%|4 · 60%/)).toBeVisible();
  await expect(overlay.getByRole('link', { name: /European Environment Agency/ })).toBeVisible();
  await expect(overlay.getByText('Fictional field tokens')).toBeVisible();
  await expect(overlay.locator('[data-command]')).toHaveCount(0);
  const results = await new AxeBuilder({ page: overlay }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  await page.getByRole('button', { name: 'Reset session' }).click();
  await expect(overlay.getByText(/OBS link revoked/)).toBeVisible();
  await overlayContext.close();
});

test('390px mobile, reduced motion and narrow 640px viewport remain operable without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await startDemo(page);
  const measurements = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    focusOutline: getComputedStyle(document.querySelector('button')).outlineStyle,
  }));
  expect(measurements.scrollWidth).toBeLessThanOrEqual(measurements.width);
  expect(measurements.reducedMotion).toBe(true);
  await page.getByRole('button', { name: 'Add sample audience' }).click();
  await expect(page.getByRole('button', { name: 'Close round & review' })).toBeVisible();
  // A 640 CSS-pixel viewport approximates the effective width of a 1280px desktop at 200% zoom.
  await page.setViewportSize({ width: 640, height: 900 });
  const narrow = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(narrow.scrollWidth).toBeLessThanOrEqual(narrow.width);
});

test('captures studio and OBS review screenshots at specified design sizes', async ({ page, browser }) => {
  await mkdir(evidenceDir, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  const startButtonBottom = await page.getByRole('button', { name: /Try without Twitch/ }).evaluate((button) => button.getBoundingClientRect().bottom);
  expect(startButtonBottom).toBeLessThanOrEqual(720);
  await page.screenshot({ path: new URL('studio-1280x720.png', evidenceDir).pathname, fullPage: true });
  await startDemo(page);
  await page.getByRole('button', { name: 'Add sample audience' }).click();
  await expect(page.locator('#toast')).not.toHaveClass(/visible/);
  const overlayUrl = (await (await page.request.get('/api/operator/overlay-link')).json()).url;
  const wide = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await wide.goto(overlayUrl);
  await expect(wide.getByRole('heading', { name: 'Make room for food' })).toBeVisible();
  await wide.screenshot({ path: new URL('overlay-1920x1080.png', evidenceDir).pathname });
  await wide.setViewportSize({ width: 1280, height: 720 });
  await wide.screenshot({ path: new URL('overlay-1280x720.png', evidenceDir).pathname });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: new URL('studio-390x844.png', evidenceDir).pathname, fullPage: true });
  await wide.close();
});
