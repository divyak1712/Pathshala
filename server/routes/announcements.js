import { Router } from 'express'
import { pool } from '../db.js'
import { requireAuth, requireRole, canAccessClass, teacherClassIds, HttpError, need, int } from '../lib/access.js'
import { sendMail } from '../lib/mailer.js'

const router = Router()
router.use(requireAuth)

const AUDIENCES = ['all', 'teacher', 'student', 'parent']

// Visibility rules by role. $1 = user id.
const VISIBLE = {
  admin: { sql: 'TRUE', params: () => [] },
  teacher: {
    sql: `(a.created_by = $1 OR (a.audience IN ('all','teacher') AND (a.class_id IS NULL OR a.class_id = ANY($2))))`,
    params: async (u) => [await teacherClassIds(u.id)],
  },
  student: {
    sql: `a.audience IN ('all','student') AND (a.class_id IS NULL OR a.class_id = (SELECT class_id FROM students WHERE user_id = $1))`,
    params: () => [],
  },
  parent: {
    sql: `a.audience IN ('all','parent') AND (a.class_id IS NULL OR a.class_id IN
            (SELECT s.class_id FROM students s JOIN parent_students ps ON ps.student_id = s.id WHERE ps.parent_id = $1))`,
    params: () => [],
  },
}

router.get('/', async (req, res) => {
  const v = VISIBLE[req.user.role]
  const extra = await v.params(req.user)
  const { rows } = await pool.query(
    `SELECT a.id, a.title, a.body, a.audience, a.class_id, a.created_at, u.name AS author,
            CASE WHEN c.id IS NULL THEN NULL ELSE c.name || ' ' || c.section END AS class_name,
            (a.created_by = $1) AS mine
     FROM announcements a LEFT JOIN "user" u ON u.id = a.created_by LEFT JOIN classes c ON c.id = a.class_id
     WHERE ${v.sql} ORDER BY a.created_at DESC LIMIT 100`,
    [req.user.id, ...extra]
  )
  res.json(rows)
})

router.post('/', requireRole('admin', 'teacher'), async (req, res) => {
  const title = need(req.body.title, 'Title is required')
  const body = need(req.body.body, 'Message is required')
  const audience = req.body.audience || 'all'
  if (!AUDIENCES.includes(audience)) throw new HttpError(400, 'Invalid audience')
  const classId = req.body.class_id ? int(req.body.class_id, 'Invalid class') : null

  if (req.user.role === 'teacher') {
    // Teachers may only address their own classes, and never other teachers.
    if (!classId) throw new HttpError(403, 'Teachers must pick one of their classes')
    if (!(await canAccessClass(req.user, classId))) throw new HttpError(403, 'Not your class')
    if (audience === 'teacher') throw new HttpError(403, 'Teachers cannot announce to teachers')
  }

  const { rows } = await pool.query(
    'INSERT INTO announcements (title, body, audience, class_id, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [title, body, audience, classId, req.user.id])

  // Fire-and-forget email to the audience (no-op unless SMTP is configured).
  const { rows: people } = await pool.query(
    `SELECT DISTINCT u.email FROM "user" u
     LEFT JOIN students s ON s.user_id = u.id
     LEFT JOIN parent_students ps ON ps.parent_id = u.id LEFT JOIN students ks ON ks.id = ps.student_id
     WHERE u.active AND ($1 = 'all' OR u.role = $1)
       AND ($2::int IS NULL OR s.class_id = $2 OR ks.class_id = $2 OR u.role IN ('teacher','admin'))`,
    [audience, classId])
  sendMail({ to: people.map((p) => p.email), subject: `[Pathshala] ${title}`, text: body })

  res.status(201).json(rows[0])
})

router.delete('/:id', requireRole('admin', 'teacher'), async (req, res) => {
  const { rows } = await pool.query('SELECT created_by FROM announcements WHERE id = $1', [int(req.params.id, 'Invalid id')])
  if (!rows[0]) throw new HttpError(404, 'Announcement not found')
  if (req.user.role !== 'admin' && rows[0].created_by !== req.user.id) throw new HttpError(403, 'You can only delete your own announcements')
  await pool.query('DELETE FROM announcements WHERE id = $1', [req.params.id])
  res.json({ ok: true })
})

export default router
