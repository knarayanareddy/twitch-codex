import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', fullyParallel: false, retries: 0, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4181', browserName: 'chromium', trace: 'retain-on-failure' },
  webServer: {
    command: 'node src/server.js', url: 'http://127.0.0.1:4181/api/health', timeout: 30_000, reuseExistingServer: !process.env.CI,
    env: { NODE_ENV: 'test', QUIET_QUEST_TEST_MODE: '1', HOST: '0.0.0.0', PORT: '4181', DATABASE_PATH: ':memory:', DEMO_MODE: '1', DEMO_PASSCODE: 'quiet-quest-test-passphrase', QUIET_QUEST_COOKIE_SECRET: 'q'.repeat(64), TWITCH_TOKEN_ENCRYPTION_KEY: 'a'.repeat(64) },
  },
});
