import { Pool } from 'pg'

// pg treats `sslmode=require` in the URL as full certificate verification, which fails on providers
// with a private CA (Aiven) and overrides the `ssl` option. Strip it and decide SSL explicitly.
// Set DATABASE_CA to the provider's CA certificate (PEM) to verify the server instead of skipping it.
function config() {
  const raw = process.env.DATABASE_URL
  if (!raw) return {}
  const url = new URL(raw)
  const sslmode = url.searchParams.get('sslmode')
  url.searchParams.delete('sslmode')
  const local = ['localhost', '127.0.0.1'].includes(url.hostname)
  let ssl = false
  if (!local && sslmode !== 'disable') {
    ssl = process.env.DATABASE_CA ? { ca: process.env.DATABASE_CA.replace(/\\n/g, '\n') } : { rejectUnauthorized: false }
  }
  return { connectionString: url.toString(), ssl }
}

export const pool = new Pool(config())
