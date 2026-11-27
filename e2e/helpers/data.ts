let counter = 0;

/** Short unique token, unique across runs (time) and within a run (counter + random). */
export function uid(): string {
  counter += 1;
  return `${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function uniqueEmail(prefix = 'user'): string {
  // Ordinary-looking domain: IANA special-use TLDs (.test/.example/.invalid) are rejected by validators.
  return `api.${prefix}.${uid()}@playwright-tests.dev`;
}

function isoDay(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/** Bucketed dates: each spec file picks its own bucket start (1000, 2000, ...) so two specs never share a date. */
export const futureDate = (bucketStartDays: number, n = 0) => isoDay(bucketStartDays + n);
export const pastDate = (bucketStartDays: number, n = 0) => isoDay(-(bucketStartDays + n));
export const today = () => isoDay(0);
export const daysFromToday = (n: number) => isoDay(n);

export const round2 = (n: number) => Math.round(n * 100) / 100;
