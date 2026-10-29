import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { createApp } from '../src/server.js';
import { Store } from '../src/adapters/store.js';

const evidenceDir = new URL('../docs/evidence/', import.meta.url);
await mkdir(evidenceDir, { recursive: true });
const store = new Store(':memory:');
const app = createApp({ store, env: {}, logger: { error: (message) => console.error(message) } });
await new Promise((resolve, reject) => app.server.listen(0, '127.0.0.1', resolve).once('error', reject));
const base = `http://127.0.0.1:${app.server.address().port}`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  reducedMotion: 'reduce',
  recordVideo: { dir: new URL('../docs/evidence/', import.meta.url).pathname, size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
const video = page.video();
const pause = (ms = 700) => page.waitForTimeout(ms);
try {
  await page.goto(base);
  await pause(1_000);
  await page.getByRole('button', { name: /Try without Twitch/ }).click();
  await pause();
  await page.getByRole('button', { name: 'Rehearse a tie' }).click();
  await pause();
  await page.getByRole('button', { name: 'Close round & review' }).click();
  await page.getByRole('button', { name: /Plant native wildflower strips/ }).click();
  await pause();
  await page.getByRole('button', { name: /Commit choice & continue/ }).click();
  await pause(1_000);
  await page.getByRole('button', { name: 'Add sample audience' }).click();
  await page.getByRole('button', { name: 'Close round & review' }).click();
  await page.getByRole('button', { name: /Commit choice & continue/ }).click();
  await pause(1_000);
  await page.getByRole('button', { name: 'Add sample audience' }).click();
  await page.getByRole('button', { name: 'Close round & review' }).click();
  await page.getByRole('button', { name: /Connect semi-natural habitat patches/ }).click();
  await page.getByRole('button', { name: /Commit choice & continue/ }).click();
  await pause(1_000);
  await page.getByRole('button', { name: /Add a wider mix of flowering periods/ }).click();
  await page.getByRole('button', { name: /Commit choice & continue/ }).click();
  await page.getByRole('heading', { name: 'Field notes from this run' }).waitFor();
  await pause(2_000);
} finally {
  await context.close();
  if (video) await video.saveAs(new URL('../docs/evidence/habitat-relay-demo-rehearsal.webm', import.meta.url).pathname);
  await browser.close();
  await app.close();
  store.close();
}
console.log('Saved simulated, local-only rehearsal to docs/evidence/habitat-relay-demo-rehearsal.webm');
