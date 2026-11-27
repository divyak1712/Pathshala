import path from 'node:path';

/** The Pathshala app this suite tests (sibling directory of api-tests/). */
export const APP_DIR = path.resolve(__dirname, '..', '..');

// Dedicated port so the suite can run next to a dev server on :3000 (which points at the REAL database).
export const PORT = 3100;
export const BASE_URL = `http://localhost:${PORT}`;

// Pinned into the spawned server's env so assertions are deterministic.
export const ADMIN = {
  name: 'API Test Admin',
  email: 'api.admin@playwright-tests.dev',
  password: 'ApiAdmin!2345',
};
export const PASSWORD = 'ApiTest!2345';
export const WEBHOOK_SECRET = 'whsec_api_tests_only';
