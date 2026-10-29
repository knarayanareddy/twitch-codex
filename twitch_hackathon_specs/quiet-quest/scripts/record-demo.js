import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { chromium } from '@playwright/test';

const ROOT = '/Users/brightech/Downloads/twitch hackathon/twitch_hackathon_specs/quiet-quest';
const OUTPUT = '/Users/brightech/Downloads/twitch hackathon/docs/videos/quiet-quest-demo.webm';
const PASSCODE = 'quiet-quest-local-demo';

async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qq-record-'));
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
    QUIET_QUEST_TEST_MODE: '1',
    DEMO_MODE: '1',
    DEMO_PASSCODE: PASSCODE,
    QUIET_QUEST_COOKIE_SECRET: randomBytes(32).toString('hex'),
    TWITCH_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
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
  await page.getByLabel('Operator passphrase').fill(PASSCODE);
  await page.getByRole('button', { name: /Open studio/ }).click();
  await pause(1200);

  // Start demo round
  await page.getByRole('button', { name: /Start demo round/ }).click();
  await page.locator('#phase-badge').getByText('Round open').waitFor();
  await pause(1500);

  // Simulate chat 1
  await page.locator('#demo-actor').selectOption('sample-1');
  await page.getByRole('button', { name: /Simulate chat contribution/ }).click();
  await pause(1000);

  // Simulate chat 2
  await page.locator('#demo-actor').selectOption('sample-2');
  await page.getByRole('button', { name: /Simulate chat contribution/ }).click();
  await pause(1200);

  // Simulate chat 3
  await page.locator('#demo-actor').selectOption('sample-3');
  await page.getByRole('button', { name: /Simulate chat contribution/ }).click();
  await pause(1500);

  // Close round
  await page.getByRole('button', { name: /Close round/ }).click();
  await page.locator('#phase-badge').getByText('Round result').waitFor();
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
console.log('Quiet Quest demo recorded successfully!');
