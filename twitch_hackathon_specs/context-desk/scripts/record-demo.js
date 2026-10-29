import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { chromium } from '@playwright/test';

const ROOT = '/Users/brightech/Downloads/twitch hackathon/twitch_hackathon_specs/context-desk';
const OUTPUT = '/Users/brightech/Downloads/twitch hackathon/docs/videos/context-desk-demo.webm';
const PASSCODE = 'context-desk-demo-passphrase';

async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cd-record-'));
const port = await freePort();
let serverProcess = null;
let browser = null;
let context = null;
let video = null;

try {
  const env = {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    NODE_ENV: 'test',
    CONTEXT_DESK_TEST_MODE: '1',
    DEMO_MODE: '1',
    DEMO_PASSCODE: PASSCODE,
    CONTEXT_DESK_COOKIE_SECRET: randomBytes(32).toString('hex'),
    CONTEXT_DESK_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    DATABASE_PATH: path.join(tempDir, 'record.sqlite')
  };
  serverProcess = spawn(process.execPath, ['src/server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: tempDir, size: { width: 1280, height: 720 } },
    reducedMotion: 'reduce'
  });
  const page = await context.newPage();
  const pause = (ms = 1000) => new Promise((r) => setTimeout(r, ms));

  await page.goto(base);
  await pause(1000);
  await page.getByLabel('Local access passphrase').fill(PASSCODE);
  await page.getByRole('button', { name: /Open the review desk/ }).click();
  await pause(1500);

  // Click Try the demo
  await page.getByRole('button', { name: /Try the demo/ }).click();
  await pause(1200);

  // Click Pluto question
  await page.getByRole('button', { name: /Why is Pluto called a dwarf planet/ }).click();
  await pause(1500);

  // Check citation
  const citeBox = page.getByLabel(/Cite What is a Planet/).first();
  if (await citeBox.count()) await citeBox.check();
  await pause(1000);

  // Confirm review
  const confirmReview = page.getByLabel(/Confirm human review/);
  if (await confirmReview.count()) await confirmReview.check();
  await pause(1000);

  // Approve card
  const approveBtn = page.getByRole('button', { name: /Approve and publish to overlay/ });
  if (await approveBtn.count()) {
    await approveBtn.click();
    await pause(2000);
  }

  // Go to Published & recap
  await page.getByRole('button', { name: /Published & recap/ }).click();
  await pause(2000);

  video = page.video();
} catch (err) {
  console.error(err);
} finally {
  if (context) await context.close();
  if (browser) await browser.close();
  if (serverProcess) serverProcess.kill('SIGKILL');
  if (video) {
    const src = await video.path();
    await fs.rename(src, OUTPUT).catch(async () => {
      await fs.copyFile(src, OUTPUT);
      await fs.rm(src, { force: true });
    });
  }
  await fs.rm(tempDir, { recursive: true, force: true });
}
console.log('Context Desk demo recorded successfully!');
