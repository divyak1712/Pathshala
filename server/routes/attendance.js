import { Router } from 'express'
import { pool } from '../db.js'
import { requireAuth, requireRole, canAccessClass, resolveStudentId, HttpError, int, dateStr } from '../lib/access.js'

const router = Router()
router.use(requireAuth)

const STATUSES = ['present', 'absent', 'late', 'excused']

// Class register for one day (teacher of the class / admin). Unmarked students come back with status null.
router.get('/class/:classId', requireRole('admin', 'teacher'), async (req, res) => {
  const classId = int(req.params.classId, 'Invalid class')
  const date = dateStr(req.query.date, 'date=YYYY-MM-DD is required')
  if (!(await canAccessClass(req.user, classId))) throw new HttpError(403, 'Not your class')
  const { rows } = await pool.query(
    `SELECT s.id AS student_id, u.name, s.roll_no, a.status
     FROM students s JOIN "user" u ON u.id = s.user_id
     LEFT JOIN attendance a ON a.student_id = s.id AND a.date = $2
     WHERE s.class_id = $1 ORDER BY s.roll_no NULLS LAST, u.name`,
    [classId, date]
  )
  res.json(rows)
})

router.put('/class/:classId', requireRole('admin', 'teacher'), async (req, res) => {
  const classId = int(req.params.classId, 'Invalid class')
  const date = dateStr(req.body.date, 'date is required')
  const records = Array.isArray(req.body.records) ? req.body.records : []
  if (!(await canAccessClass(req.user, classId))) throw new HttpError(403, 'Not your class')
  for (const r of records) if (!STATUSES.includes(r.status)) throw new HttpError(400, `Invalid status "${r.status}"`)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const r of records) {
      // Only students actually in this class can be marked — never trust client-supplied ids.
      const { rowCount } = await client.query('SELECT 1 FROM students WHERE id = $1 AND class_id = $2', [r.student_id, classId])
      if (!rowCount) throw new HttpError(400, 'Student does not belong to this class')
      await client.query(
        `INSERT INTO attendance (student_id, class_id, date, status, marked_by) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (student_id, date) DO UPDATE SET status = EXCLUDED.status, class_id = EXCLUDED.class_id, marked_by = EXCLUDED.marked_by`,
        [r.student_id, classId, date, r.status, req.user.id]
      )
    }
    await client.query('COMMIT')
    res.json({ saved: records.length })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

// A student's history. Students: own; parents: linked child; teachers/admin: if permitted.
router.get('/student', async (req, res) => {
  const studentId = await resolveStudentId(req)
  const { rows } = await pool.query(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date, status FROM attendance WHERE student_id = $1 ORDER BY date DESC LIMIT 180`,
    [studentId]
  )
  const summary = { present: 0, absent: 0, late: 0, excused: 0 }
  rows.forEach((r) => summary[r.status]++)
  const counted = rows.length - summary.excused
  const percentage = counted ? Math.round(((summary.present + summary.late) / counted) * 1000) / 10 : null
  res.json({ records: rows, summary, percentage })
})

export default router
