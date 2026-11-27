import { Router } from 'express'
import { pool } from '../db.js'
import { requireAuth, requireRole, canTeachClassSubject, resolveStudentId, HttpError, need, int, num, dateStr } from '../lib/access.js'

const router = Router()
router.use(requireAuth)

const COLS = `SELECT a.id, a.title, a.description, to_char(a.due_date,'YYYY-MM-DD') AS due_date, a.max_marks::float AS max_marks,
    a.class_subject_id, sub.name AS subject, c.name || ' ' || c.section AS class_name`
const FROM = ` FROM assignments a JOIN class_subjects cs ON cs.id = a.class_subject_id
  JOIN subjects sub ON sub.id = cs.subject_id JOIN classes c ON c.id = cs.class_id`

// Teachers/admin: assignments for subjects they teach. Students/parents: their class's assignments + submission state.
router.get('/', async (req, res) => {
  const { role, id } = req.user
  if (role === 'student' || role === 'parent') {
    const studentId = await resolveStudentId(req)
    const { rows } = await pool.query(
      `${COLS}, sm.content AS submission, sm.marks::float AS marks, sm.feedback, sm.submitted_at ${FROM}
       JOIN students st ON st.class_id = cs.class_id AND st.id = $1
       LEFT JOIN submissions sm ON sm.assignment_id = a.id AND sm.student_id = st.id
       ORDER BY a.due_date DESC`,
      [studentId]
    )
    return res.json(rows)
  }
  const { rows } = await pool.query(
    `${COLS}, (SELECT count(*)::int FROM submissions s WHERE s.assignment_id = a.id) AS submitted ${FROM}
     WHERE ($1 = 'admin' OR cs.teacher_id = $2) ORDER BY a.due_date DESC`,
    [role, id]
  )
  res.json(rows)
})


router.post('/', requireRole('admin', 'teacher'), async (req, res) => {
  const csId = int(req.body.class_subject_id, 'Class subject is required')
  if (!(await canTeachClassSubject(req.user, csId))) throw new HttpError(403, 'Not your subject')
  const { rows } = await pool.query(
    `INSERT INTO assignments (class_subject_id, title, description, due_date, max_marks, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [csId, need(req.body.title, 'Title is required'), req.body.description || '', dateStr(req.body.due_date, 'Due date is required'),
     req.body.max_marks ? num(req.body.max_marks, 'Invalid max marks') : 10, req.user.id])
  res.status(201).json(rows[0])
})

async function loadAssignment(req) {
  const { rows } = await pool.query('SELECT * FROM assignments WHERE id = $1', [int(req.params.id, 'Invalid assignment')])
  if (!rows[0]) throw new HttpError(404, 'Assignment not found')
  return rows[0]
}

router.delete('/:id', requireRole('admin', 'teacher'), async (req, res) => {
  const a = await loadAssignment(req)
  if (!(await canTeachClassSubject(req.user, a.class_subject_id))) throw new HttpError(403, 'Not your subject')
  await pool.query('DELETE FROM assignments WHERE id = $1', [a.id])
  res.json({ ok: true })
})

// Student submits (or re-submits before it is graded) their own work.
router.post('/:id/submit', requireRole('student'), async (req, res) => {
  const a = await loadAssignment(req)
  const studentId = await resolveStudentId(req)
  const { rowCount } = await pool.query(
    `SELECT 1 FROM students s JOIN class_subjects cs ON cs.class_id = s.class_id WHERE s.id = $1 AND cs.id = $2`, [studentId, a.class_subject_id])
  if (!rowCount) throw new HttpError(403, 'This assignment is not for your class')
  const { rowCount: saved } = await pool.query(
    `INSERT INTO submissions (assignment_id, student_id, content) VALUES ($1,$2,$3)
     ON CONFLICT (assignment_id, student_id) DO UPDATE SET content = EXCLUDED.content, submitted_at = now()
     WHERE submissions.marks IS NULL`,
    [a.id, studentId, need(req.body.content, 'Submission cannot be empty')])
  if (!saved) throw new HttpError(409, 'Already graded; cannot resubmit')
  res.json({ ok: true })
})

router.get('/:id/submissions', requireRole('admin', 'teacher'), async (req, res) => {
  const a = await loadAssignment(req)
  if (!(await canTeachClassSubject(req.user, a.class_subject_id))) throw new HttpError(403, 'Not your subject')
  const { rows } = await pool.query(
    `SELECT s.id AS student_id, u.name, s.roll_no, sm.content, sm.submitted_at, sm.marks::float AS marks, sm.feedback
     FROM class_subjects cs JOIN students s ON s.class_id = cs.class_id JOIN "user" u ON u.id = s.user_id
     LEFT JOIN submissions sm ON sm.assignment_id = $1 AND sm.student_id = s.id
     WHERE cs.id = $2 ORDER BY s.roll_no NULLS LAST, u.name`, [a.id, a.class_subject_id])
  res.json({ max_marks: Number(a.max_marks), submissions: rows })
})

router.put('/:id/submissions/:studentId', requireRole('admin', 'teacher'), async (req, res) => {
  const a = await loadAssignment(req)
  if (!(await canTeachClassSubject(req.user, a.class_subject_id))) throw new HttpError(403, 'Not your subject')
  const marks = num(req.body.marks, 'Marks must be a number')
  if (marks < 0 || marks > Number(a.max_marks)) throw new HttpError(400, `Marks must be between 0 and ${a.max_marks}`)
  const { rowCount } = await pool.query(
    'UPDATE submissions SET marks = $3, feedback = $4 WHERE assignment_id = $1 AND student_id = $2',
    [a.id, int(req.params.studentId, 'Invalid student'), marks, req.body.feedback || null])
  if (!rowCount) throw new HttpError(404, 'No submission from this student')
  res.json({ ok: true })
})

export default router
