import { Router } from 'express'
import { auth } from '../auth.js'
import { pool } from '../db.js'
import { requireAuth, requireRole, HttpError, ROLES, need, int } from '../lib/access.js'
import { sendMail } from '../lib/mailer.js'

const router = Router()
router.use(requireAuth, requireRole('admin'))

router.get('/', async (req, res) => {
  const { role } = req.query
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.email, u.role, u.active, u."createdAt" AS created_at,
            s.id AS student_id, s.admission_no, s.class_id
     FROM "user" u LEFT JOIN students s ON s.user_id = u.id
     WHERE ($1::text IS NULL OR u.role = $1) ORDER BY u.role, u.name`,
    [ROLES.includes(role) ? role : null]
  )
  res.json(rows)
})

// Provision an account. Public sign-up is blocked at the HTTP layer; this is the only way in.
router.post('/', async (req, res) => {
  const name = need(req.body.name, 'Name is required')
  const email = need(req.body.email, 'Email is required').toLowerCase()
  const password = need(req.body.password, 'Password is required')
  const role = req.body.role
  if (!ROLES.includes(role)) throw new HttpError(400, 'Invalid role')
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters')

  const student = req.body.student
  if (role === 'student') {
    need(student?.admission_no, 'Admission number is required for students')
  }

  let created
  try {
    created = await auth.api.signUpEmail({ body: { name, email, password } })
  } catch (err) {
    throw new HttpError(400, err.body?.message || 'Could not create user (email may already exist)')
  }
  const userId = created.user.id
  try {
    await pool.query('UPDATE "user" SET role = $1 WHERE id = $2', [role, userId])
    if (role === 'student') {
      await pool.query(
        `INSERT INTO students (user_id, class_id, admission_no, roll_no, dob, phone) VALUES ($1,$2,$3,$4,$5,$6)`,
        [userId, student.class_id || null, student.admission_no, student.roll_no || null, student.dob || null, student.phone || null]
      )
    }
  } catch (err) {
    await pool.query('DELETE FROM "user" WHERE id = $1', [userId]) // roll back the half-created account
    throw err
  }
  sendMail({
    to: email,
    subject: 'Your Pathshala account',
    text: `Hello ${name},\n\nAn account was created for you (${role}).\nSign in at ${process.env.BETTER_AUTH_URL} with this email and the temporary password your administrator shared.`,
  })
  res.status(201).json({ id: userId, name, email, role })
})

router.patch('/:id', async (req, res) => {
  const { id } = req.params
  const { rows } = await pool.query('SELECT id FROM "user" WHERE id = $1', [id])
  if (!rows[0]) throw new HttpError(404, 'User not found')
  const isSelf = id === req.user.id

  if (req.body.role !== undefined) {
    if (!ROLES.includes(req.body.role)) throw new HttpError(400, 'Invalid role')
    if (isSelf && req.body.role !== 'admin') throw new HttpError(400, 'You cannot change your own role')
  }
  if (req.body.active === false && isSelf) throw new HttpError(400, 'You cannot deactivate yourself')

  await pool.query(
    `UPDATE "user" SET name = COALESCE($2, name), role = COALESCE($3, role), active = COALESCE($4, active), "updatedAt" = now() WHERE id = $1`,
    [id, req.body.name?.trim() || null, req.body.role ?? null, typeof req.body.active === 'boolean' ? req.body.active : null]
  )
  if (req.body.active === false) await pool.query('DELETE FROM "session" WHERE "userId" = $1', [id])

  if (req.body.password) {
    if (String(req.body.password).length < 8) throw new HttpError(400, 'Password must be at least 8 characters')
    const ctx = await auth.$context
    const hash = await ctx.password.hash(req.body.password)
    await pool.query(`UPDATE "account" SET password = $1, "updatedAt" = now() WHERE "userId" = $2 AND "providerId" = 'credential'`, [hash, id])
    await pool.query('DELETE FROM "session" WHERE "userId" = $1', [id])
  }
  res.json({ ok: true })
})

router.delete('/:id', async (req, res) => {
  if (req.params.id === req.user.id) throw new HttpError(400, 'You cannot delete yourself')
  const { rowCount } = await pool.query('DELETE FROM "user" WHERE id = $1', [req.params.id])
  if (!rowCount) throw new HttpError(404, 'User not found')
  res.json({ ok: true })
})

// Link parents to a student (replaces the set).
router.put('/students/:studentId/parents', async (req, res) => {
  const studentId = int(req.params.studentId, 'Invalid student')
  const parentIds = Array.isArray(req.body.parentIds) ? req.body.parentIds : []
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM parent_students WHERE student_id = $1', [studentId])
    for (const pid of parentIds) {
      const { rowCount } = await client.query(`SELECT 1 FROM "user" WHERE id = $1 AND role = 'parent'`, [pid])
      if (!rowCount) throw new HttpError(400, 'Linked user is not a parent')
      await client.query('INSERT INTO parent_students (parent_id, student_id) VALUES ($1,$2)', [pid, studentId])
    }
    await client.query('COMMIT')
    res.json({ ok: true })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

export default router
