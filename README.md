# Pathshala – School Management SaaS

Express + React (Vite) + Postgres + Better Auth, served from a single Node process.
One school per deployment (single-tenant).

## Quick start

```bash
npm install
cp .env.example .env        # fill in DATABASE_URL and BETTER_AUTH_SECRET (openssl rand -base64 32)
npm run db:setup            # applies schema + creates the first admin (ADMIN_EMAIL / ADMIN_PASSWORD)
npm run db:demo             # optional: demo teachers/students/parents/class/fees (password Demo12345!)
npm run dev                 # http://localhost:3000
```

Production: `npm run build && npm start`.

## Automated tests (Playwright)

Two standalone suites, each with its own `package.json`. Both run against a **dedicated test database** and start their own app server
(never reuse a running one), so they cannot touch real data.

| Suite | Folder | Run | What it covers |
|---|---|---|---|
| API | `api-tests/` | `npm run test:api` | Every endpoint over HTTP: auth, role and ownership checks, validation, money math, Stripe webhook signatures, error-contract shape, and a `race` project for concurrency invariants (`npm --prefix api-tests run test:race`) |
| UI | `e2e/` | `npm run test:e2e` | Real Chromium (**headed**, never headless) driving each role's dashboard and workflows through page objects |

One-time setup per suite: `npm install` inside the folder (UI suite also `npx playwright install chromium`), then copy
`.env.api.example` to `.env.api` (or `.env.e2e.example` to `.env.e2e`) and set `TEST_DATABASE_URL` to a database that is **not**
the one in the app's `.env` (a second database on the same Postgres service is fine). The suites refuse to run if the two resolve
to the same host and database. Ports: app dev server 3000, API suite 3100, UI suite 3200.

## Roles and permissions (enforced server-side in `server/lib/access.js`)

| Role | Access |
|---|---|
| admin | Users, classes, subjects, teaching assignments, timetable, fees and payments, announcements, attendance |
| teacher | Only classes/subjects they teach: attendance, assessments and grades, assignments and grading, timetable, announcements to their classes |
| student | Own attendance, grades, timetable, fees. Submits assignments. Sees announcements for them |
| parent | Same as student, read-only, for linked children only. Can pay fees |

There is **no public sign-up** (blocked in `server/index.js`). Admins create accounts under *Users*.
`role` and `active` are Better Auth `additionalFields` with `input: false`, so clients cannot set them.

## Configuration

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string (Neon etc.). `localhost` URLs skip SSL |
| `BETTER_AUTH_SECRET` | yes | Session signing secret |
| `BETTER_AUTH_URL` | yes | Public base URL (also used for Stripe return URLs and email links) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | first run | Bootstrap admin created by `db:setup` |
| `STRIPE_SECRET_KEY` | optional | Enables online fee payment (Stripe Checkout). Without it, "Pay online" returns a clear 501 message and admins record offline payments |
| `STRIPE_WEBHOOK_SECRET` | with Stripe | Verifies `POST /api/webhooks/stripe` (event `checkout.session.completed`) |
| `CURRENCY` | optional | Stripe currency code, default `inr` |
| `SMTP_HOST/PORT/USER/PASS`, `MAIL_FROM` | optional | Email for new accounts and announcements. Without it, emails are logged and skipped |

## Not included

Deployment/hosting/CI, multi-school tenancy, file uploads (assignment submissions are text), SMS/WhatsApp, report-card PDFs.
