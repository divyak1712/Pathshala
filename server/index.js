import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { toNodeHandler } from 'better-auth/node'
import { auth } from './auth.js'
import { HttpError } from './lib/access.js'
import meRouter from './routes/me.js'
import usersRouter from './routes/users.js'
import academicsRouter from './routes/academics.js'
import attendanceRouter from './routes/attendance.js'
import gradesRouter from './routes/grades.js'
import assignmentsRouter from './routes/assignments.js'
import timetableRouter from './routes/timetable.js'
import feesRouter from './routes/fees.js'
import announcementsRouter from './routes/announcements.js'
import dashboardRouter from './routes/dashboard.js'
import webhooksRouter from './routes/webhooks.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const isProduction = process.env.NODE_ENV === 'production'
const port = process.env.PORT || 3000

async function createServer() {
  const app = express()

  // Accounts are provisioned by admins only: block public sign-up over HTTP.
  // (Server-side auth.api.signUpEmail calls from the admin routes are unaffected.)
  app.post('/api/auth/sign-up/*splat', (req, res) => res.status(403).json({ error: 'Sign-up is disabled. Ask your school administrator.' }))

  // Must be mounted before express.json() — Better Auth needs the raw request stream.
  app.all('/api/auth/*splat', toNodeHandler(auth))

  // Stripe webhook needs the raw body for signature verification, so it also precedes express.json().
  app.use('/api/webhooks', webhooksRouter)

  app.use(express.json())

  app.get('/api/health', (req, res) =>
    res.json({
      ok: true,
      integrations: { stripe: Boolean(process.env.STRIPE_SECRET_KEY), email: Boolean(process.env.SMTP_HOST) },
    })
  )
  app.use('/api/me', meRouter)
  app.use('/api/users', usersRouter)
  app.use('/api/attendance', attendanceRouter)
  app.use('/api/grades', gradesRouter)
  app.use('/api/assignments', assignmentsRouter)
  app.use('/api/timetable', timetableRouter)
  app.use('/api/fees', feesRouter)
  app.use('/api/announcements', announcementsRouter)
  app.use('/api/dashboard', dashboardRouter)
  app.use('/api', academicsRouter) // classes, subjects, class-subjects, students

  // Unknown API routes must be JSON 404s, never the SPA shell.
  app.all('/api/*splat', (req, res) => res.status(404).json({ error: 'Not found' }))

  if (isProduction) {
    const distDir = path.join(root, 'dist')
    app.use(express.static(distDir))
    app.use((req, res) => res.sendFile(path.join(distDir, 'index.html')))
  } else {
    const { createServer: createViteServer } = await import('vite')
    const vite = await createViteServer({ root, server: { middlewareMode: true }, appType: 'custom' })
    app.use(vite.middlewares)
    app.use(async (req, res, next) => {
      try {
        let template = await fs.readFile(path.join(root, 'index.html'), 'utf-8')
        template = await vite.transformIndexHtml(req.originalUrl, template)
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template)
      } catch (err) {
        vite.ssrFixStacktrace(err)
        next(err)
      }
    })
  }

  // Every error leaves as { error: string }.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message })
    if (err.code === '23505') return res.status(409).json({ error: 'That record already exists' })
    if (err.code === '23503') return res.status(400).json({ error: 'Refers to a record that does not exist (or is still in use)' })
    if (err.code === '23514' || err.code === '22P02' || err.code === '22007') return res.status(400).json({ error: 'Invalid value supplied' })
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  })

  app.listen(port, () => {
    console.log(`Pathshala listening on http://localhost:${port} (${isProduction ? 'production' : 'development'})`)
  })
}

createServer()
