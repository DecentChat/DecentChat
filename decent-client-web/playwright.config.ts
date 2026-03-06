import { defineConfig } from '@playwright/test';

const SIGNAL_PORT = Number(process.env.PW_SIGNAL_PORT || '9000');
const ENABLE_SIGNALING = process.env.PW_ENABLE_SIGNALING !== '0';
process.env.PW_SIGNAL_PORT = String(SIGNAL_PORT);

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  testIgnore: ['**/*.live-smoke.spec.ts', '**/p2p-live.spec.ts', '**/production-test.spec.ts'],
  timeout: 30000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    ...(ENABLE_SIGNALING
      ? [{
          command: `SIGNAL_PORT=${SIGNAL_PORT} bun run scripts/signaling-server.ts`,
          port: SIGNAL_PORT,
          reuseExistingServer: false,
          timeout: 60000,
          cwd: '..',
        }]
      : []),
    {
      command: `VITE_SIGNAL_PORT=${SIGNAL_PORT} bun run dev -- --host 127.0.0.1 --port 5173`,
      port: 5173,
      reuseExistingServer: true,
      timeout: 45000,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
    {
      name: 'firefox',
      use: { browserName: 'firefox' },
    },
  ],
});
