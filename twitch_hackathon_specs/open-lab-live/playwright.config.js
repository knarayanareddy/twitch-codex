import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4191', headless: true, trace: 'retain-on-failure' },
  webServer: {
    command: 'npm start',
    url: 'http://127.0.0.1:4191/api/health',
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      HOST: '0.0.0.0', PORT: '4191', NODE_ENV: 'test', DEMO_MODE: '1',
      DEMO_PASSCODE: 'open-lab-e2e-passphrase', OPEN_LAB_COOKIE_SECRET: 'a'.repeat(64),
      OPEN_LAB_TEST_MODE: '1', DATABASE_PATH: './data/e2e.sqlite',
    },
  },
});
