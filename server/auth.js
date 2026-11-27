import { betterAuth } from 'better-auth'
import { pool } from './db.js'

export const auth = betterAuth({
  database: pool,
  emailAndPassword: { enabled: true },
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  trustedOrigins: [process.env.BETTER_AUTH_URL].filter(Boolean),
  user: {
    additionalFields: {
      // input:false => clients can never set these; only server code (admin routes) can.
      role: { type: 'string', required: false, defaultValue: 'student', input: false },
      active: { type: 'boolean', required: false, defaultValue: true, input: false },
    },
  },
})
