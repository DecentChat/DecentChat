import { defineConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const SIGNAL_PORT = Number(process.env.PW_SIGNAL_PORT || '9000');
const WEB_PORT = Number(process.env.PW_WEB_PORT || '46173');
const TEST_SCOPE = process.env.PW_SCOPE || 'all';
const E2E_SCOPE = TEST_SCOPE === 'e2e';
const INTEGRATION_SCOPE = TEST_SCOPE === 'integration';
const REUSE_EXISTING_SERVER = process.env.PW_REUSE_SERVER === '1';
const DEFAULT_WORKERS = process.env.CI ? 2 : 1;
const WORKERS = Number(process.env.PW_WORKERS || String(DEFAULT_WORKERS));
const SIGNAL_RUN_KEY = process.env.PW_SIGNAL_RUN_KEY || randomUUID();
process.env.PW_SIGNAL_PORT = String(SIGNAL_PORT);
process.env.PW_WEB_PORT = String(WEB_PORT);
process.env.PW_SIGNAL_RUN_KEY = SIGNAL_RUN_KEY;

export default defineConfig({
  globalSetup: './tests/playwright/global-setup.ts',
  globalTeardown: './tests/playwright/global-teardown.ts',
  testDir: E2E_SCOPE ? './tests/e2e' : INTEGRATION_SCOPE ? './tests/integration' : './tests',
  testMatch: '**/*.spec.ts',
  testIgnore: [
    '**/*.live-smoke.spec.ts',
    '**/p2p-live.spec.ts',
    '**/production-test.spec.ts',
    '**/integration/capability-peer-failure.spec.ts',
    '**/integration/presence-slices.spec.ts',
    '**/integration/public-channel-fanout.spec.ts',
    '**/integration/public-workspace-mixed-client.spec.ts',
    ...(E2E_SCOPE
      ? [
          '**/sync-reliability.spec.ts',
          '**/qr-transfer-mobile-sync.spec.ts',
          '**/huddle-real-bot.spec.ts',
          '**/huddle-audio-debug.spec.ts',
          '**/huddle-three-peers.spec.ts',
          '**/live-delivery-debug.spec.ts',
        ]
      : []),
    ...(INTEGRATION_SCOPE
      ? [
          '**/messaging.spec.ts',
          '**/multi-device-negentropy-sync.spec.ts',
          '**/multi-user.spec.ts',
          '**/partial-mesh-observability.spec.ts',
          '**/qr-transfer-sync.spec.ts',
          '**/threads.spec.ts',
        ]
      : []),
  ],
  timeout: 30000,
  retries: 0,
  workers: WORKERS,
  fullyParallel: false,
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `VITE_SIGNAL_PORT=${SIGNAL_PORT} ./node_modules/.bin/vite --host 127.0.0.1 --port ${WEB_PORT}`,
    port: WEB_PORT,
    timeout: 90000,
    reuseExistingServer: REUSE_EXISTING_SERVER,
  },
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
