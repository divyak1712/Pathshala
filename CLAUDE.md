# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Pathshala is a single-tenant school management app: Express 5 + React 19 (Vite) + Postgres + Better Auth, all served by one Node process. Roles: admin, teacher, student, parent. See `README.md` for the env var table and `docs/REQUIREMENTS.md` for scope.

## Commands

```bash
npm run dev          # node server/index.js — Express with Vite in middleware mode (NOT a separate vite server), :3000
npm run build        # vite build -> dist/
npm start            # production: serves dist/ + SPA fallback (cross-env sets NODE_ENV)
npm run db:setup     # applies server/db/schema.sql, bootstraps first admin from ADMIN_* env if none exists
npm run db:demo      # optional demo data (accounts @school.local, password Demo12345!)
npm run lint         # oxlint
npm run test:smoke   # scripts/smoke.mjs — API + permission suite against a RUNNING server and demo data
```

- Playwright suites: `api-tests/` (HTTP only, includes a `race` project for concurrency invariants) and `e2e/` (real **headed** Chromium; page objects in `e2e/page-objects`). Run with `npm run test:api` / `npm run test:e2e`. One file or test: `npm --prefix api-tests exec playwright test tests/fees.spec.ts -g "overpay"` (same for `e2e`).
- Each Playwright suite needs `TEST_DATABASE_URL` in its gitignored `.env.api` / `.env.e2e`, pointing at a DIFFERENT database than the app's own; the config throws at load otherwise (`helpers/db-safety.ts` compares host+port+database against the app's `.env` and the shell). They spawn their own server (ports 3100 / 3200, `NODE_ENV=test` so auth rate limits stay off, `reuseExistingServer: false`) and apply the schema through the app's `db:setup` at config load, before the server starts. The UI suite stays `headless: false` and the API suite `headless: true` by design.
- The full API suite takes ~25 minutes (every spec provisions its own users/classes over HTTP against a remote DB), so run single files while iterating. The test DB is never cleaned; data accumulates by design (unique emails, bucketed dates).
- **Known failing API tests = open app bugs, not test bugs** (last full run: 134 pass, 5 fail). Do not weaken these tests; fix the app: (1) `race.spec.ts` overlapping timetable periods: the clash check in `routes/timetable.js` is read-then-insert, so concurrent requests all succeed; (2) an impossible date like `2020-02-30` passes `dateStr()` in `lib/access.js` (V8 rolls it over) then Postgres rejects it as an unmapped error -> 500 instead of 400; (3) malformed JSON bodies return 500 because the central error handler ignores `err.status` from `express.json()`; (4) two marks-validation tests: error text prints raw NUMERIC (`...between 0 and 10.00`) in `routes/grades.js` and `routes/assignments.js`.
- `npm run lint` (oxlint from the repo root) also lints `api-tests/` and `e2e/`.
- Outside the Playwright suites there is no unit-test runner and no single-test flag. `scripts/smoke.mjs` is one sequential script (`check(name, cond)` calls); to iterate on one area, temporarily comment out other sections or add a focused `check`. Pass a base URL as the first arg to target another port.
- The smoke suite logs in as the demo users and as `admin@school.local`, so run `db:setup` and `db:demo` first. It does not load `.env`: the admin password comes from the shell's `ADMIN_PASSWORD`, defaulting to `ChangeMe123!`. It creates its own assignment each run and asserts fee balances relatively, so it is re-runnable.
- The smoke suite, `db:setup` and `db:demo` all write to whatever database `DATABASE_URL` points at (there is no separate test DB), so don't aim them at real school data.
- **Backend code does not hot-reload.** Vite HMR covers `src/` only; restart `npm run dev` after editing anything under `server/`.
- `.env` needs `DATABASE_URL` and `BETTER_AUTH_SECRET`. `dotenv/config` must stay the first import in every entrypoint (`server/index.js`, `db/migrate.js`, `db/demo.js`) because `server/db.js` reads env at import time.

## Architecture

**Request flow and mount order in `server/index.js` is load-bearing:**
1. `POST /api/auth/sign-up/*splat` → 403 (public sign-up disabled; accounts are admin-provisioned).
2. `/api/auth/*splat` → Better Auth (needs the raw body, so before `express.json()`).
3. `/api/webhooks` (Stripe) → also before `express.json()`; signature verification needs the raw bytes.
4. `express.json()`, then feature routers, then `academicsRouter` mounted at bare `/api` **last** (it applies `requireAuth` router-wide, so mounting it earlier would intercept other routers' requests).
5. Unknown `/api/*` → JSON 404, then Vite/static + SPA fallback, then a central error handler. All errors are `{ error: string }`; the frontend's `src/api.js` depends on that shape. Express 5 forwards async rejections, so route handlers `throw new HttpError(status, msg)` rather than try/catch; pg codes 23505/23503/23514 are mapped to 409/400 in the handler.

**Authorization lives in `server/lib/access.js`, not in the UI.** Every router starts with `router.use(requireAuth)` (sets `req.user = {id,name,email,role}`), then uses `requireRole(...)` plus record-level checks:
- `canAccessStudent` / `resolveStudentId` — students always resolve to themselves (any `studentId` param is ignored); parents must be linked via `parent_students`; teachers only for students in their classes. Student/parent-facing endpoints (`/attendance/student`, `/grades/student`, `/fees`, `/assignments`, `/timetable`, `/dashboard`) all take `?studentId=` and go through this.
- `canAccessClass` (class teacher OR any subject teacher of the class) governs attendance and rosters.
- `canTeachClassSubject` (only the assigned `class_subjects.teacher_id`, or admin) governs assessments, grades, assignments and submission grading. Class teachers deliberately do **not** get grading rights over colleagues' subjects.
- The data model's teaching unit is `class_subjects` (class × subject × teacher); assessments, assignments and timetable rows hang off it.

**Auth/identity:** Better Auth owns `"user"`, `"session"`, `"account"`, `"verification"` (quoted camelCase columns). `role` and `active` are `additionalFields` with `input: false`, so clients can never set them; only server code does (`UPDATE "user" SET role`). Admin-created accounts go through `auth.api.signUpEmail` server-side, then a role update; password resets hash via `(await auth.$context).password.hash`. Deactivating a user deletes their sessions, and `requireAuth` also rejects `active === false`. The four auth tables in `schema.sql` were hand-written (the Better Auth CLI needs a live DB to generate them); they work, but re-diff against `npx @better-auth/cli generate` if upgrading Better Auth.

**Database:** one idempotent, append-only `server/db/schema.sql` run by `db:setup` — no migration framework; never put destructive statements in it. `server/db.js` strips `sslmode` from `DATABASE_URL` and sets SSL itself (pg treats `sslmode=require` as full cert verification, which fails on Aiven's private CA); set `DATABASE_CA` for strict verification. `pg` returns NUMERIC as strings, so queries cast `::float`/`Number()`, and dates are returned with `to_char(..., 'YYYY-MM-DD')` to avoid timezone shifts. Multi-statement writes use `pool.connect()` with BEGIN/COMMIT/ROLLBACK/release; fee payments `SELECT ... FOR UPDATE` the fee to stop overpayment races; `payments.reference UNIQUE` makes Stripe webhook retries idempotent.

**Optional integrations degrade gracefully:** `server/lib/stripe.js` (REST, no SDK; `POST /api/fees/:id/checkout` returns 501 if `STRIPE_SECRET_KEY` unset) and `server/lib/mailer.js` (nodemailer; logs and no-ops without `SMTP_HOST`, never throws). `GET /api/health` reports which are configured.

**Frontend (`src/`):** react-router, no UI library, plain `styles.css`. `lib/app-context.jsx` loads `/api/me` and holds the parent's selected child (`studentId`). Role-specific nav is in `components/Layout.jsx`; route gating in `App.jsx` (`Protected roles=[...]`) is convenience only. Most pages are one file that switches on role (e.g. `Attendance` renders a teacher register or a student history; `Fees` renders admin ledger or student/parent view). Data fetching uses `useLoad(fn, deps)` / `useAction()` from `components/ui.jsx`; `withStudent(url, studentId)` in `api.js` appends the child id.

## Conventions worth knowing

- Never trust client-supplied ids, totals or marks: handlers re-verify class membership, marks ≤ max, and payment amount ≤ balance server-side.
- When adding a student-scoped endpoint, use `resolveStudentId(req)`; when adding a teacher-scoped one, pick `canAccessClass` vs `canTeachClassSubject` deliberately (see above).
- Express 5: catch-all routes need a named splat (`/*splat`), not bare `*`.
- oxlint's `react/set-state-in-effect` is turned off in `.oxlintrc.json` (data-sync effects are intentional).
- Deployed on Railway (project `pathshala`, service `pathshala`, env `production`, https://pathshala-production.up.railway.app) via the CLI: `railway up --ci` uploads the working dir (honours `.gitignore` + `.railwayignore`) and Nixpacks runs `npm run build` then `npm start`. Do NOT set `NODE_ENV` as a Railway variable: it makes `npm ci` skip devDependencies (vite, cross-env) and the build fails. Required variables: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (must equal the public https URL). The deploy is not wired to git pushes. It points at the same Aiven database used for local dev, so local `db:demo`/smoke runs would pollute production data.
- Not built: multi-school tenancy, file uploads (submissions are text), PDF report cards, CI.
