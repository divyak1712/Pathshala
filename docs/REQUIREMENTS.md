# Pathshala requirements

## Roles
Admin, Teacher, Student, Parent. Accounts are provisioned by admins; no self-registration.

## Functional requirements
1. **Auth**: email/password sign-in, change password, admin password reset, deactivate (revokes sessions).
2. **Admin**: CRUD users and role changes. CRUD classes and subjects. Assign teachers to class+subject. Place students in classes. Link parents to students. Build the timetable (class and teacher clash detection). Bill fees per student or class, record offline payments, view the ledger. Post announcements. Mark attendance for any class.
3. **Teacher**: only for classes they teach or are class teacher of. Mark daily attendance. Create assessments and enter marks (bounded by max). Post assignments, view submissions, grade with feedback. See own timetable. Announce to own classes.
4. **Student**: view own attendance (with %), grades by subject, timetable, fees. Submit and resubmit assignments until graded. Pay fees online.
5. **Parent**: switch between linked children. Same read views as student. Pay fees online.
6. **Dashboards**: role-specific KPIs.
7. **Announcements**: targeted by audience role and optional class, with email fan-out when SMTP is configured.

## Non-functional
- Authorization checked on every API route, scoped to the record (not just the role).
- Server recomputes and validates all money and marks. Payment writes row-lock the fee. Stripe webhooks are idempotent (`payments.reference` UNIQUE).
- Idempotent, append-only `schema.sql`. Uniform `{ error }` API errors.

## External integrations (need configuration)
Stripe (online payment), SMTP (email). See README.
