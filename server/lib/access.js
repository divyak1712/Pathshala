import { fromNodeHeaders } from 'better-auth/node'
import { auth } from '../auth.js'
import { pool } from '../db.js'

export const ROLES = ['admin', 'teacher', 'student', 'parent']

export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/** Resolves the session and attaches req.user = { id, name, email, role }. */
export async function requireAuth(req, res, next) {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })
  if (!session) return res.status(401).json({ error: 'Sign in required' })
  if (session.user.active === false) return res.status(403).json({ error: 'Account deactivated' })
  const { id, name, email, role } = session.user
  req.user = { id, name, email, role }
  next()
}

export const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user?.role) ? next() : res.status(403).json({ error: 'Not allowed for your role' })

/** Class ids a teacher is responsible for (class teacher or subject teacher). */
export async function teacherClassIds(userId) {
  const { rows } = await pool.query(
    `SELECT id AS class_id FROM classes WHERE class_teacher_id = $1
     UNION SELECT class_id FROM class_subjects WHERE teacher_id = $1`,
    [userId]
  )
  return rows.map((r) => r.class_id)
}

/** Can this user act on this class? (admin always; teacher if assigned) */
export async function canAccessClass(user, classId) {
  if (user.role === 'admin') return true
  if (user.role !== 'teacher') return false
  return (await teacherClassIds(user.id)).includes(Number(classId))
}

/** Can this user teach this class_subject? Only its assigned subject teacher (or admin) — class teachers do not get grading rights over colleagues' subjects. */
export async function canTeachClassSubject(user, csId) {
  if (user.role === 'admin') return true
  if (user.role !== 'teacher') return false
  const { rowCount } = await pool.query('SELECT 1 FROM class_subjects WHERE id = $1 AND teacher_id = $2', [csId, user.id])
  return rowCount > 0
}

/** Can this user read this student's records? */
export async function canAccessStudent(user, studentId) {
  const id = Number(studentId)
  if (!Number.isInteger(id)) return false
  if (user.role === 'admin') return true
  if (user.role === 'student') {
    const { rowCount } = await pool.query('SELECT 1 FROM students WHERE id = $1 AND user_id = $2', [id, user.id])
    return rowCount > 0
  }
  if (user.role === 'parent') {
    const { rowCount } = await pool.query('SELECT 1 FROM parent_students WHERE student_id = $1 AND parent_id = $2', [id, user.id])
    return rowCount > 0
  }
  if (user.role === 'teacher') {
    const { rows } = await pool.query('SELECT class_id FROM students WHERE id = $1', [id])
    return rows.length > 0 && (await teacherClassIds(user.id)).includes(rows[0].class_id)
  }
  return false
}

/** Which student's data to show? Students always get their own; others must pass studentId and be allowed. */
export async function resolveStudentId(req) {
  const { user } = req
  if (user.role === 'student') {
    const { rows } = await pool.query('SELECT id FROM students WHERE user_id = $1', [user.id])
    if (!rows[0]) throw new HttpError(404, 'No student profile for this account')
    return rows[0].id
  }
  const id = Number(req.query.studentId ?? req.body?.studentId)
  if (!Number.isInteger(id)) throw new HttpError(400, 'studentId is required')
  if (!(await canAccessStudent(user, id))) throw new HttpError(403, 'No access to this student')
  return id
}

export function need(value, message) {
  if (value === undefined || value === null || String(value).trim() === '') throw new HttpError(400, message)
  return typeof value === 'string' ? value.trim() : value
}
export function int(value, message) {
  const n = Number(value)
  if (value === '' || value === null || !Number.isInteger(n)) throw new HttpError(400, message)
  return n
}
export function num(value, message) {
  const n = Number(value)
  if (value === '' || value === null || value === undefined || !Number.isFinite(n)) throw new HttpError(400, message)
  return n
}
export function dateStr(value, message) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)) || Number.isNaN(Date.parse(value))) throw new HttpError(400, message)
  return value
}
