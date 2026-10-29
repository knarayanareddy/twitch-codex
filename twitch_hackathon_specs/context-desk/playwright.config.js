import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4174', browserName: 'chromium', trace: 'retain-on-failure' },
  webServer: {
    command: 'node src/server.js',
    url: 'http://127.0.0.1:4174/api/health',
    timeout: 30_000,
    reuseExistingServer: !process.env.CI,
    env: {
      NODE_ENV: 'test', CONTEXT_DESK_TEST_MODE: '1',
      HOST: '0.0.0.0', PORT: '4174', DATABASE_PATH: ':memory:',
      DEMO_MODE: '1', DEMO_PASSCODE: 'context-desk-demo-passphrase',
      CONTEXT_DESK_SESSION_ID: 'e'.repeat(40), CONTEXT_DESK_COOKIE_SECRET: 'c'.repeat(64),
    },
  },
});
