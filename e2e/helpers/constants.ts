import path from 'node:path';

/** The Pathshala app this suite tests (sibling directory of e2e/). */
export const APP_DIR = path.resolve(__dirname, '..', '..');

// Dedicated port (API suite uses 3100, dev server 3000). One Express process serves API + frontend.
export const PORT = 3200;
export const BASE_URL = `http://localhost:${PORT}`;

export const ADMIN = {
  name: 'E2E Test Admin',
  email: 'e2e.admin@playwright-tests.dev',
  password: 'E2eAdmin!2345',
};
export const PASSWORD = 'E2eTest!2345';
