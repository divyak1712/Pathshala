import { Router } from 'express'
import { pool } from '../db.js'
import { requireAuth } from '../lib/access.js'

const router = Router()
router.use(requireAuth)

// Current user plus the student profile(s) they can view (self for students, children for parents).
router.get('/', async (req, res) => {
  const { user } = req
  let students = []
  if (user.role === 'student' || user.role === 'parent') {
    const sql = `SELECT s.id, u.name, s.admission_no, s.roll_no, s.class_id, c.name || ' ' || c.section AS class_name
                 FROM students s JOIN "user" u ON u.id = s.user_id LEFT JOIN classes c ON c.id = s.class_id`
    const { rows } =
      user.role === 'student'
        ? await pool.query(`${sql} WHERE s.user_id = $1`, [user.id])
        : await pool.query(`${sql} JOIN parent_students ps ON ps.student_id = s.id WHERE ps.parent_id = $1 ORDER BY u.name`, [user.id])
    students = rows
  }
  res.json({ user, students })
})

export default router
