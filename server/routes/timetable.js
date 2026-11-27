import { Router } from 'express'
import { pool } from '../db.js'
import { requireAuth, requireRole, resolveStudentId, HttpError, int } from '../lib/access.js'

const router = Router()
router.use(requireAuth)

const SELECT = `SELECT t.id, t.day, to_char(t.start_time,'HH24:MI') AS start_time, to_char(t.end_time,'HH24:MI') AS end_time, t.room,
    cs.id AS class_subject_id, cs.class_id, s.name AS subject, c.name || ' ' || c.section AS class_name, u.name AS teacher_name
  FROM timetable t JOIN class_subjects cs ON cs.id = t.class_subject_id JOIN subjects s ON s.id = cs.subject_id
  JOIN classes c ON c.id = cs.class_id LEFT JOIN "user" u ON u.id = cs.teacher_id`

router.get('/', async (req, res) => {
  const { role, id } = req.user
  let rows
  if (role === 'student' || role === 'parent') {
    const studentId = await resolveStudentId(req)
    ;({ rows } = await pool.query(
      `${SELECT} WHERE cs.class_id = (SELECT class_id FROM students WHERE id = $1) ORDER BY t.day, t.start_time`, [studentId]))
  } else if (role === 'teacher') {
    ;({ rows } = await pool.query(`${SELECT} WHERE cs.teacher_id = $1 ORDER BY t.day, t.start_time`, [id]))
  } else {
    const classId = req.query.classId ? Number(req.query.classId) : null
    ;({ rows } = await pool.query(`${SELECT} WHERE ($1::int IS NULL OR cs.class_id = $1) ORDER BY t.day, t.start_time`, [classId]))
  }
  res.json(rows)
})

router.post('/', requireRole('admin'), async (req, res) => {
  const csId = int(req.body.class_subject_id, 'Class subject is required')
  const day = int(req.body.day, 'Day is required')
  const { start_time: start, end_time: end, room } = req.body
  if (day < 1 || day > 7) throw new HttpError(400, 'Day must be 1 (Mon) to 7 (Sun)')
  if (!/^\d{2}:\d{2}$/.test(start || '') || !/^\d{2}:\d{2}$/.test(end || '')) throw new HttpError(400, 'Times must be HH:MM')
  if (end <= start) throw new HttpError(400, 'End time must be after start time')

  // Reject overlaps for the same class or the same teacher.
  const { rows: clash } = await pool.query(
    `SELECT 1 FROM timetable t JOIN class_subjects o ON o.id = t.class_subject_id, class_subjects me
     WHERE me.id = $1 AND t.day = $2 AND t.start_time < $4::time AND t.end_time > $3::time
       AND (o.class_id = me.class_id OR (me.teacher_id IS NOT NULL AND o.teacher_id = me.teacher_id)) LIMIT 1`,
    [csId, day, start, end]
  )
  if (clash.length) throw new HttpError(409, 'Clashes with an existing period for this class or teacher')

  const { rows } = await pool.query(
    'INSERT INTO timetable (class_subject_id, day, start_time, end_time, room) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [csId, day, start, end, room || null]
  )
  res.status(201).json(rows[0])
})

router.delete('/:id', requireRole('admin'), async (req, res) => {
  await pool.query('DELETE FROM timetable WHERE id = $1', [int(req.params.id, 'Invalid id')])
  res.json({ ok: true })
})

export default router
