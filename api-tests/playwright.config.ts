import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'node:path';
import { ADMIN, APP_DIR, BASE_URL, PORT, WEBHOOK_SECRET } from './helpers/constants';
import { applySchemaOnce } from './helpers/db-setup';
import { assertTestDbIsIsolated } from './helpers/db-safety';

dotenv.config({ path: path.join(__dirname, '.env.api') });
const testDbUrl = assertTestDbIsIsolated(); // throws before anything starts
applySchemaOnce(testDbUrl); // schema first: the app expects its tables at startup

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0, // a retry would hide a flaky invariant; fix the cause instead
  timeout: 60_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    headless: true, // ALWAYS true (project rule). API tests open no browser; this pins it for any future browser test.
  },
  projects: [
    { name: 'functional', testIgnore: /race\.spec\.ts/ },
    { name: 'race', testMatch: /race\.spec\.ts/ },
  ],
  webServer: {
    command: 'node server/index.js',
    cwd: APP_DIR,
    url: `${BASE_URL}/api/auth/ok`, // does not touch the database
    reuseExistingServer: false, // an already-running server was started against the REAL database
    timeout: 90_000,
    env: {
      ...(process.env as Record<string, string>),
      DATABASE_URL: testDbUrl,
      PORT: String(PORT),
      BETTER_AUTH_URL: BASE_URL,
      NODE_ENV: 'test', // NOT production: production enables auth rate limits that the suite would trip
      ADMIN_NAME: ADMIN.name,
      ADMIN_EMAIL: ADMIN.email,
      ADMIN_PASSWORD: ADMIN.password,
      // Pinned integration state so assertions are deterministic regardless of the developer's shell/.env.
      // (Empty string, not unset: dotenv will not override a variable that is already defined.)
      STRIPE_SECRET_KEY: '',
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      SMTP_HOST: '',
      CURRENCY: 'inr',
    },
  },
});
