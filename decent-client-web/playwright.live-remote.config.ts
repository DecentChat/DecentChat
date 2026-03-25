import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/live-delivery-debug.spec.ts',
  timeout: 240000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  use: {
    headless: false,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
