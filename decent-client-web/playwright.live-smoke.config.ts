import { defineConfig } from '@playwright/test';

const SIGNAL_PORT = Number(process.env.PW_SIGNAL_PORT || '19090');
process.env.PW_SIGNAL_PORT = String(SIGNAL_PORT);

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.live-smoke.spec.ts',
  timeout: 90000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: `SIGNAL_PORT=${SIGNAL_PORT} bun run scripts/signaling-server.ts`,
      url: `http://localhost:${SIGNAL_PORT}/peerjs`,
      reuseExistingServer: true,
      timeout: 10000,
      cwd: '..',
    },
    {
      command: `VITE_SIGNAL_PORT=${SIGNAL_PORT} bun run dev`,
      port: 5173,
      reuseExistingServer: true,
      timeout: 15000,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
