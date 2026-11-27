import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'node:path';
import { ADMIN, APP_DIR, BASE_URL, PORT } from './helpers/constants';
import { applySchemaOnce } from './helpers/db-setup';
import { assertTestDbIsIsolated } from './helpers/db-safety';

dotenv.config({ path: path.join(__dirname, '.env.e2e') });
const testDbUrl = assertTestDbIsIsolated(); // throws before anything starts
applySchemaOnce(testDbUrl); // schema first: the app expects its tables at startup

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  // Serial on purpose: the dev server compiles pages on demand and the test DB is remote; parallel specs
  // show up as blank pages and false selector timeouts. A slower deterministic run beats a flaky one.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    headless: false, // ALWAYS false (project rule): tests run in a visible browser window.
    viewport: { width: 1280, height: 800 },
    actionTimeout: 15_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], headless: false } }],
  // One Express process serves the API and the Vite frontend.
  webServer: {
    command: 'node server/index.js',
    cwd: APP_DIR,
    url: `${BASE_URL}/api/auth/ok`,
    reuseExistingServer: false, // an already-running server was started against the REAL database
    timeout: 90_000,
    env: {
      ...(process.env as Record<string, string>),
      DATABASE_URL: testDbUrl,
      PORT: String(PORT),
      BETTER_AUTH_URL: BASE_URL,
      NODE_ENV: 'test', // not production: auth rate limits would trip when the suite signs in repeatedly
      ADMIN_NAME: ADMIN.name,
      ADMIN_EMAIL: ADMIN.email,
      ADMIN_PASSWORD: ADMIN.password,
      STRIPE_SECRET_KEY: '', // pinned: online payment shows the "not configured" message
      SMTP_HOST: '',
    },
  },
});
