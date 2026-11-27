import { spawnSync } from 'node:child_process';
import { ADMIN, APP_DIR, BASE_URL } from './constants';
import { redact } from './db-safety';

/**
 * Applies the app's own idempotent schema + first-admin bootstrap (`npm run db:setup`) to the TEST database.
 * Called at config load (before webServer starts: the app needs its tables at startup). Guarded by an
 * env flag because Playwright workers re-import the config.
 */
export function applySchemaOnce(testUrl: string): void {
  if (process.env.E2E_SCHEMA_READY === '1') return;
  const result = spawnSync('npm run db:setup', {
    cwd: APP_DIR,
    shell: true,
    encoding: 'utf8',
    env: {
      ...process.env,
      DATABASE_URL: testUrl, // dotenv never overrides an already-set variable, so this beats the app's .env
      ADMIN_NAME: ADMIN.name,
      ADMIN_EMAIL: ADMIN.email,
      ADMIN_PASSWORD: ADMIN.password,
      BETTER_AUTH_URL: BASE_URL,
      NODE_ENV: 'test',
    },
  });
  if (result.status !== 0) {
    throw new Error(`db:setup failed against the test database (exit ${result.status}):\n${redact(`${result.stdout}\n${result.stderr}`.slice(-1500))}`);
  }
  process.env.E2E_SCHEMA_READY = '1';
}
