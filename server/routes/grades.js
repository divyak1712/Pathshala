import { Router } from 'express'
import { pool } from '../db.js'
import { requireAuth, requireRole, canTeachClassSubject, resolveStudentId, HttpError, need, int, num, dateStr } from '../lib/access.js'

const router = Router()
router.use(requireAuth)

const KINDS = ['exam', 'quiz', 'test', 'project']

async function loadAssessment(req) {
  const id = int(req.params.id, 'Invalid assessment')
  const { rows } = await pool.query(
    `SELECT a.*, cs.class_id FROM assessments a JOIN class_subjects cs ON cs.id = a.class_subject_id WHERE a.id = $1`, [id])
  if (!rows[0]) throw new HttpError(404, 'Assessment not found')
  if (!(await canTeachClassSubject(req.user, rows[0].class_subject_id))) throw new HttpError(403, 'Not your subject')
  return rows[0]
}

router.get('/assessments', requireRole('admin', 'teacher'), async (req, res) => {
  const csId = int(req.query.classSubjectId, 'classSubjectId is required')
  if (!(await canTeachClassSubject(req.user, csId))) throw new HttpError(403, 'Not your subject')
  const { rows } = await pool.query(
    `SELECT id, title, kind, max_marks::float AS max_marks, to_char(date,'YYYY-MM-DD') AS date,
            (SELECT count(*)::int FROM grades g WHERE g.assessment_id = assessments.id) AS graded
     FROM assessments WHERE class_subject_id = $1 ORDER BY date DESC, id DESC`, [csId])
  res.json(rows)
})

router.post('/assessments', requireRole('admin', 'teacher'), async (req, res) => {
  const csId = int(req.body.class_subject_id, 'Class subject is required')
  if (!(await canTeachClassSubject(req.user, csId))) throw new HttpError(403, 'Not your subject')
  const kind = req.body.kind || 'exam'
  if (!KINDS.includes(kind)) throw new HttpError(400, 'Invalid kind')
  const max = num(req.body.max_marks, 'Max marks is required')
  if (max <= 0) throw new HttpError(400, 'Max marks must be positive')
  const { rows } = await pool.query(
    `INSERT INTO assessments (class_subject_id, title, kind, max_marks, date) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [csId, need(req.body.title, 'Title is required'), kind, max, dateStr(req.body.date, 'Date is required')])
  res.status(201).json(rows[0])
})

router.delete('/assessments/:id', requireRole('admin', 'teacher'), async (req, res) => {
  const a = await loadAssessment(req)
  await pool.query('DELETE FROM assessments WHERE id = $1', [a.id])
  res.json({ ok: true })
})

router.get('/assessments/:id/grades', requireRole('admin', 'teacher'), async (req, res) => {
  const a = await loadAssessment(req)
  const { rows } = await pool.query(
    `SELECT s.id AS student_id, u.name, s.roll_no, g.marks::float AS marks, g.remarks
     FROM students s JOIN "user" u ON u.id = s.user_id
     LEFT JOIN grades g ON g.student_id = s.id AND g.assessment_id = $1
     WHERE s.class_id = $2 ORDER BY s.roll_no NULLS LAST, u.name`, [a.id, a.class_id])
  res.json({ max_marks: Number(a.max_marks), grades: rows })
})

router.put('/assessments/:id/grades', requireRole('admin', 'teacher'), async (req, res) => {
  const a = await loadAssessment(req)
  const entries = Array.isArray(req.body.grades) ? req.body.grades : []
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const g of entries) {
      const { rowCount } = await client.query('SELECT 1 FROM students WHERE id = $1 AND class_id = $2', [g.student_id, a.class_id])
      if (!rowCount) throw new HttpError(400, 'Student does not belong to this class')
      if (g.marks === '' || g.marks === null || g.marks === undefined) {
        await client.query('DELETE FROM grades WHERE assessment_id = $1 AND student_id = $2', [a.id, g.student_id])
        continue
      }
      const marks = num(g.marks, 'Marks must be a number')
      if (marks < 0 || marks > Number(a.max_marks)) throw new HttpError(400, `Marks must be between 0 and ${a.max_marks}`)
      await client.query(
        `INSERT INTO grades (assessment_id, student_id, marks, remarks) VALUES ($1,$2,$3,$4)
         ON CONFLICT (assessment_id, student_id) DO UPDATE SET marks = EXCLUDED.marks, remarks = EXCLUDED.remarks`,
        [a.id, g.student_id, marks, g.remarks || null])
    }
    await client.query('COMMIT')
    res.json({ saved: entries.length })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

// Report card data for one student (own / child / permitted teacher / admin).
router.get('/student', async (req, res) => {
  const studentId = await resolveStudentId(req)
  const { rows } = await pool.query(
    `SELECT a.id, a.title, a.kind, to_char(a.date,'YYYY-MM-DD') AS date, a.max_marks::float AS max_marks,
            g.marks::float AS marks, g.remarks, sub.name AS subject
     FROM grades g JOIN assessments a ON a.id = g.assessment_id
     JOIN class_subjects cs ON cs.id = a.class_subject_id JOIN subjects sub ON sub.id = cs.subject_id
     WHERE g.student_id = $1 ORDER BY a.date DESC, a.id DESC`, [studentId])
  const bySubject = {}
  for (const r of rows) {
    const s = (bySubject[r.subject] ??= { subject: r.subject, got: 0, max: 0 })
    s.got += r.marks
    s.max += r.max_marks
  }
  const subjects = Object.values(bySubject).map((s) => ({ subject: s.subject, percentage: Math.round((s.got / s.max) * 1000) / 10 }))
  res.json({ grades: rows, subjects })
})

export default router
