import dotenv from 'dotenv';
import path from 'node:path';
import { assertTestDbIsIsolated } from './helpers/db-safety';

// Second, independent isolation guard (the first runs at config load, before the server starts).
export default async function globalSetup() {
  dotenv.config({ path: path.join(__dirname, '.env.e2e') });
  assertTestDbIsIsolated();
}
