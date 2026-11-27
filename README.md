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
