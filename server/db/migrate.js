import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from '../db.js'
import { auth } from '../auth.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function migrate() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set. Add it to .env first.')
  const schema = await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf-8')
  await pool.query(schema)
  console.log('Schema applied.')

  // Bootstrap the first admin so someone can sign in.
  const { rows } = await pool.query(`SELECT 1 FROM "user" WHERE role = 'admin' LIMIT 1`)
  if (rows.length === 0) {
    const email = (process.env.ADMIN_EMAIL || 'admin@school.local').toLowerCase()
    const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!'
    const created = await auth.api.signUpEmail({ body: { name: process.env.ADMIN_NAME || 'School Admin', email, password } })
    await pool.query(`UPDATE "user" SET role = 'admin' WHERE id = $1`, [created.user.id])
    console.log(`Created first admin: ${email}  (change the password after first sign-in)`)
  } else {
    console.log('Admin already exists; skipping bootstrap.')
  }
  await pool.end()
}

migrate().catch((err) => {
  console.error(err)
  process.exit(1)
})
