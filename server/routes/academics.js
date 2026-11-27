import { Router } from 'express'
import { pool } from '../db.js'
import { requireAuth, requireRole, teacherClassIds, canAccessClass, HttpError, need, int, dateStr } from '../lib/access.js'

const router = Router()
router.use(requireAuth)

// ---------- Classes ----------
router.get('/classes', requireRole('admin', 'teacher'), async (req, res) => {
  const scope = req.user.role === 'admin' ? null : await teacherClassIds(req.user.id)
  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.section, c.academic_year, c.class_teacher_id, u.name AS class_teacher_name,
            (SELECT count(*)::int FROM students s WHERE s.class_id = c.id) AS student_count
     FROM classes c LEFT JOIN "user" u ON u.id = c.class_teacher_id
     WHERE ($1::int[] IS NULL OR c.id = ANY($1)) ORDER BY c.name, c.section`,
    [scope]
  )
  res.json(rows)
})

router.post('/classes', requireRole('admin'), async (req, res) => {
  const { rows } = await pool.query(
    `INSERT INTO classes (name, section, academic_year, class_teacher_id) VALUES ($1,$2,$3,$4) RETURNING *`,
    [need(req.body.name, 'Class name is required'), req.body.section?.trim() || 'A',
     need(req.body.academic_year, 'Academic year is required'), req.body.class_teacher_id || null]
  )
  res.status(201).json(rows[0])
})

router.patch('/classes/:id', requireRole('admin'), async (req, res) => {
  const { rowCount } = await pool.query(
    `UPDATE classes SET name = COALESCE($2,name), section = COALESCE($3,section),
       academic_year = COALESCE($4,academic_year), class_teacher_id = $5 WHERE id = $1`,
    [int(req.params.id, 'Invalid class'), req.body.name || null, req.body.section || null, req.body.academic_year || null, req.body.class_teacher_id || null]
  )
  if (!rowCount) throw new HttpError(404, 'Class not found')
  res.json({ ok: true })
})

router.delete('/classes/:id', requireRole('admin'), async (req, res) => {
  await pool.query('DELETE FROM classes WHERE id = $1', [int(req.params.id, 'Invalid class')])
  res.json({ ok: true })
})

// ---------- Subjects ----------
router.get('/subjects', requireRole('admin', 'teacher'), async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM subjects ORDER BY name')
  res.json(rows)
})
router.post('/subjects', requireRole('admin'), async (req, res) => {
  const { rows } = await pool.query('INSERT INTO subjects (name, code) VALUES ($1,$2) RETURNING *', [
    need(req.body.name, 'Subject name is required'),
    need(req.body.code, 'Subject code is required').toUpperCase(),
  ])
  res.status(201).json(rows[0])
})
router.delete('/subjects/:id', requireRole('admin'), async (req, res) => {
  await pool.query('DELETE FROM subjects WHERE id = $1', [int(req.params.id, 'Invalid subject')])
  res.json({ ok: true })
})

// ---------- Teaching assignments (class_subjects) ----------
const CS_SELECT = `SELECT cs.id, cs.class_id, cs.subject_id, cs.teacher_id, s.name AS subject_name, s.code AS subject_code,
    c.name || ' ' || c.section AS class_name, t.name AS teacher_name
  FROM class_subjects cs JOIN subjects s ON s.id = cs.subject_id JOIN classes c ON c.id = cs.class_id
  LEFT JOIN "user" t ON t.id = cs.teacher_id`

// Everything the signed-in teacher can teach (or all for admin) — feeds dropdowns across the app.
router.get('/class-subjects', requireRole('admin', 'teacher'), async (req, res) => {
  const { classId } = req.query
  const scope = req.user.role === 'admin' ? null : await teacherClassIds(req.user.id)
  const { rows } = await pool.query(
    `${CS_SELECT} WHERE ($1::int[] IS NULL OR cs.class_id = ANY($1)) AND ($2::int IS NULL OR cs.class_id = $2)
     ORDER BY c.name, c.section, s.name`,
    [scope, classId ? Number(classId) : null]
  )
  res.json(req.user.role === 'teacher' ? rows.filter((r) => r.teacher_id === req.user.id) : rows)
})

router.put('/class-subjects', requireRole('admin'), async (req, res) => {
  const { rows } = await pool.query(
    `INSERT INTO class_subjects (class_id, subject_id, teacher_id) VALUES ($1,$2,$3)
     ON CONFLICT (class_id, subject_id) DO UPDATE SET teacher_id = EXCLUDED.teacher_id RETURNING id`,
    [int(req.body.class_id, 'Class is required'), int(req.body.subject_id, 'Subject is required'), req.body.teacher_id || null]
  )
  res.json(rows[0])
})
router.delete('/class-subjects/:id', requireRole('admin'), async (req, res) => {
  await pool.query('DELETE FROM class_subjects WHERE id = $1', [int(req.params.id, 'Invalid id')])
  res.json({ ok: true })
})

// ---------- Students roster ----------
router.get('/students', requireRole('admin', 'teacher'), async (req, res) => {
  const classId = req.query.classId ? Number(req.query.classId) : null
  if (classId && !(await canAccessClass(req.user, classId))) throw new HttpError(403, 'Not your class')
  const scope = req.user.role === 'admin' ? null : await teacherClassIds(req.user.id)
  const { rows } = await pool.query(
    `SELECT s.id, s.user_id, u.name, u.email, s.admission_no, s.roll_no, s.class_id, to_char(s.dob, 'YYYY-MM-DD') AS dob, s.phone,
            c.name || ' ' || c.section AS class_name,
            COALESCE((SELECT json_agg(json_build_object('id', p.id, 'name', p.name)) FROM parent_students ps
                      JOIN "user" p ON p.id = ps.parent_id WHERE ps.student_id = s.id), '[]') AS parents
     FROM students s JOIN "user" u ON u.id = s.user_id LEFT JOIN classes c ON c.id = s.class_id
     WHERE ($1::int[] IS NULL OR s.class_id = ANY($1)) AND ($2::int IS NULL OR s.class_id = $2)
     ORDER BY c.name, s.roll_no NULLS LAST, u.name`,
    [scope, classId]
  )
  res.json(rows)
})

router.patch('/students/:id', requireRole('admin'), async (req, res) => {
  const b = req.body
  const { rowCount } = await pool.query(
    `UPDATE students SET class_id = $2, roll_no = $3, admission_no = COALESCE($4, admission_no), dob = $5, phone = $6 WHERE id = $1`,
    [int(req.params.id, 'Invalid student'), b.class_id || null, b.roll_no || null, b.admission_no || null,
     b.dob ? dateStr(b.dob, 'Invalid date of birth') : null, b.phone || null]
  )
  if (!rowCount) throw new HttpError(404, 'Student not found')
  res.json({ ok: true })
})

export default router
