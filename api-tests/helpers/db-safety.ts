import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { APP_DIR } from './constants';

/** host:port/database, ignoring credentials, query string, case and Neon's -pooler suffix. */
export function dbIdentity(url: string): string {
  const u = new URL(url);
  const host = u.hostname.toLowerCase().replace('-pooler', '');
  return `${host}:${u.port || '5432'}${u.pathname.replace(/\/+$/, '').toLowerCase()}`;
}

/** Replace anything that looks like the test DB's credentials before text reaches logs/errors. */
export function redact(text: string, url = process.env.TEST_DATABASE_URL): string {
  let out = text;
  if (url) {
    try {
      const u = new URL(url);
      for (const secret of [u.password, u.username, url]) if (secret) out = out.split(secret).join('***');
    } catch {
      /* unparsable: nothing to redact */
    }
  }
  return out;
}

/**
 * Throws unless TEST_DATABASE_URL is set and points at a DIFFERENT database than the app's real one.
 * Runs at config load AND in global-setup, on every run. Never prints the URL.
 */
export function assertTestDbIsIsolated(): string {
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    throw new Error('TEST_DATABASE_URL is not set. Copy api-tests/.env.api.example to api-tests/.env.api and fill it in.');
  }
  let testId: string;
  try {
    testId = dbIdentity(testUrl);
  } catch {
    throw new Error('TEST_DATABASE_URL is not a valid connection URL.');
  }

  const realUrls: Array<[string, string]> = [];
  const appEnv = path.join(APP_DIR, '.env');
  if (fs.existsSync(appEnv)) {
    const parsed = dotenv.parse(fs.readFileSync(appEnv));
    if (parsed.DATABASE_URL) realUrls.push(['the app .env DATABASE_URL', parsed.DATABASE_URL]);
  }
  if (process.env.DATABASE_URL) realUrls.push(['the shell DATABASE_URL', process.env.DATABASE_URL]);

  for (const [source, url] of realUrls) {
    let realId: string;
    try {
      realId = dbIdentity(url);
    } catch {
      throw new Error(`${source} could not be parsed, so test-database isolation cannot be verified. Refusing to run.`);
    }
    if (realId === testId) {
      throw new Error(`TEST_DATABASE_URL points at the same database as ${source}. Use a dedicated test database. Refusing to run.`);
    }
  }
  return testUrl;
}
