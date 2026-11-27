import { Router } from 'express'
import { pool } from '../db.js'
import { requireAuth, resolveStudentId } from '../lib/access.js'

const router = Router()
router.use(requireAuth)

router.get('/', async (req, res) => {
  const { role, id } = req.user
  const one = async (sql, params = []) => (await pool.query(sql, params)).rows[0]

  if (role === 'admin') {
    const counts = await one(
      `SELECT count(*) FILTER (WHERE role='student')::int AS students, count(*) FILTER (WHERE role='teacher')::int AS teachers,
              count(*) FILTER (WHERE role='parent')::int AS parents, (SELECT count(*)::int FROM classes) AS classes FROM "user" WHERE active`)
    const att = await one(
      `SELECT count(*)::int AS marked, count(*) FILTER (WHERE status IN ('present','late'))::int AS present FROM attendance WHERE date = CURRENT_DATE`)
    const fees = await one(
      `SELECT COALESCE(sum(f.amount),0)::float AS billed, COALESCE(sum(p.paid),0)::float AS collected
       FROM fees f LEFT JOIN (SELECT fee_id, sum(amount) AS paid FROM payments GROUP BY fee_id) p ON p.fee_id = f.id`)
    const { rows: byClass } = await pool.query(
      `SELECT c.name || ' ' || c.section AS label, count(s.id)::int AS value FROM classes c LEFT JOIN students s ON s.class_id = c.id
       GROUP BY c.id ORDER BY c.name, c.section`)
    return res.json({ role, counts, attendanceToday: att, fees, studentsByClass: byClass })
  }

  if (role === 'teacher') {
    const mine = await one(
      `SELECT (SELECT count(DISTINCT class_id)::int FROM class_subjects WHERE teacher_id = $1) AS classes,
              (SELECT count(*)::int FROM assignments a JOIN class_subjects cs ON cs.id = a.class_subject_id WHERE cs.teacher_id = $1 AND a.due_date >= CURRENT_DATE) AS open_assignments,
              (SELECT count(*)::int FROM submissions sm JOIN assignments a ON a.id = sm.assignment_id
                 JOIN class_subjects cs ON cs.id = a.class_subject_id WHERE cs.teacher_id = $1 AND sm.marks IS NULL) AS to_grade`, [id])
    // ISO weekday: Monday = 1
    const { rows: today } = await pool.query(
      `SELECT to_char(t.start_time,'HH24:MI') AS start_time, to_char(t.end_time,'HH24:MI') AS end_time, t.room,
              s.name AS subject, c.name || ' ' || c.section AS class_name
       FROM timetable t JOIN class_subjects cs ON cs.id = t.class_subject_id JOIN subjects s ON s.id = cs.subject_id
       JOIN classes c ON c.id = cs.class_id WHERE cs.teacher_id = $1 AND t.day = extract(isodow FROM CURRENT_DATE) ORDER BY t.start_time`, [id])
    return res.json({ role, ...mine, today })
  }

  // student / parent: scoped to one student
  const studentId = await resolveStudentId(req)
  const att = await one(
    `SELECT count(*) FILTER (WHERE status <> 'excused')::int AS counted, count(*) FILTER (WHERE status IN ('present','late'))::int AS present
     FROM attendance WHERE student_id = $1`, [studentId])
  const gr = await one(
    `SELECT COALESCE(sum(g.marks) / NULLIF(sum(a.max_marks),0) * 100, NULL)::float AS average
     FROM grades g JOIN assessments a ON a.id = g.assessment_id WHERE g.student_id = $1`, [studentId])
  const asg = await one(
    `SELECT count(*)::int AS pending FROM assignments a JOIN class_subjects cs ON cs.id = a.class_subject_id
     JOIN students s ON s.class_id = cs.class_id AND s.id = $1
     WHERE a.due_date >= CURRENT_DATE AND NOT EXISTS (SELECT 1 FROM submissions sm WHERE sm.assignment_id = a.id AND sm.student_id = s.id)`, [studentId])
  const fee = await one(
    `SELECT COALESCE(sum(f.amount - COALESCE(p.paid,0)),0)::float AS outstanding
     FROM fees f LEFT JOIN (SELECT fee_id, sum(amount) AS paid FROM payments GROUP BY fee_id) p ON p.fee_id = f.id WHERE f.student_id = $1`, [studentId])
  const { rows: today } = await pool.query(
    `SELECT to_char(t.start_time,'HH24:MI') AS start_time, to_char(t.end_time,'HH24:MI') AS end_time, t.room, s.name AS subject, u.name AS teacher_name
     FROM timetable t JOIN class_subjects cs ON cs.id = t.class_subject_id JOIN subjects s ON s.id = cs.subject_id
     LEFT JOIN "user" u ON u.id = cs.teacher_id
     WHERE cs.class_id = (SELECT class_id FROM students WHERE id = $1) AND t.day = extract(isodow FROM CURRENT_DATE) ORDER BY t.start_time`, [studentId])
  res.json({
    role, studentId,
    attendancePercentage: att.counted ? Math.round((att.present / att.counted) * 1000) / 10 : null,
    averageGrade: gr.average === null ? null : Math.round(gr.average * 10) / 10,
    pendingAssignments: asg.pending, outstandingFees: fee.outstanding, today,
  })
})

export default router
