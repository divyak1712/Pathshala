import 'dotenv/config'
import { pool } from '../db.js'
import { auth } from '../auth.js'

// Optional demo data: 2 teachers, 1 class, 3 students, 2 parents, subjects, timetable, fees, etc.
// All demo accounts use the password "Demo12345!". Safe to re-run (skips if the demo teacher exists).
const PASSWORD = 'Demo12345!'

async function makeUser(name, email, role) {
  const existing = await pool.query('SELECT id FROM "user" WHERE email = $1', [email])
  if (existing.rows[0]) return existing.rows[0].id
  const { user } = await auth.api.signUpEmail({ body: { name, email, password: PASSWORD } })
  await pool.query('UPDATE "user" SET role = $1 WHERE id = $2', [role, user.id])
  return user.id
}

async function run() {
  if ((await pool.query(`SELECT 1 FROM "user" WHERE email = 'teacher@school.local'`)).rowCount) {
    console.log('Demo data already present.')
    return pool.end()
  }
  const t1 = await makeUser('Meera Nair', 'teacher@school.local', 'teacher')
  const t2 = await makeUser('Arun Verma', 'teacher2@school.local', 'teacher')
  const p1 = await makeUser('Sunita Sharma', 'parent@school.local', 'parent')
  const p2 = await makeUser('Rakesh Gupta', 'parent2@school.local', 'parent')

  const year = `${new Date().getFullYear()}-${String(new Date().getFullYear() + 1).slice(2)}`
  const { rows: [cls] } = await pool.query(
    `INSERT INTO classes (name, section, academic_year, class_teacher_id) VALUES ('Grade 5','A',$1,$2) RETURNING id`, [year, t1])
  const { rows: [cls2] } = await pool.query(
    `INSERT INTO classes (name, section, academic_year, class_teacher_id) VALUES ('Grade 6','A',$1,$2) RETURNING id`, [year, t2])

  const subj = {}
  for (const [name, code] of [['Mathematics', 'MATH'], ['English', 'ENG'], ['Science', 'SCI']]) {
    const { rows } = await pool.query('INSERT INTO subjects (name, code) VALUES ($1,$2) ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id', [name, code])
    subj[code] = rows[0].id
  }
  const cs = {}
  for (const [code, teacher] of [['MATH', t1], ['ENG', t2], ['SCI', t1]]) {
    const { rows } = await pool.query('INSERT INTO class_subjects (class_id, subject_id, teacher_id) VALUES ($1,$2,$3) RETURNING id', [cls.id, subj[code], teacher])
    cs[code] = rows[0].id
  }
  await pool.query('INSERT INTO class_subjects (class_id, subject_id, teacher_id) VALUES ($1,$2,$3)', [cls2.id, subj.MATH, t2])

  const students = []
  for (const [i, [name, email]] of [['Aarav Sharma', 'student@school.local'], ['Diya Gupta', 'student2@school.local'], ['Kabir Singh', 'student3@school.local']].entries()) {
    const uid = await makeUser(name, email, 'student')
    const { rows } = await pool.query(
      'INSERT INTO students (user_id, class_id, admission_no, roll_no) VALUES ($1,$2,$3,$4) RETURNING id', [uid, cls.id, `ADM-${1001 + i}`, i + 1])
    students.push(rows[0].id)
  }
  await pool.query('INSERT INTO parent_students VALUES ($1,$2),($3,$4)', [p1, students[0], p2, students[1]])

  const slots = [['MATH', 1, '09:00', '09:45'], ['ENG', 1, '10:00', '10:45'], ['SCI', 2, '09:00', '09:45'], ['MATH', 3, '09:00', '09:45'], ['ENG', 4, '10:00', '10:45'], ['SCI', 5, '09:00', '09:45']]
  for (const [code, day, s, e] of slots) {
    await pool.query('INSERT INTO timetable (class_subject_id, day, start_time, end_time, room) VALUES ($1,$2,$3,$4,$5)', [cs[code], day, s, e, 'Room 5A'])
  }
  const { rows: [asm] } = await pool.query(
    `INSERT INTO assessments (class_subject_id, title, kind, max_marks, date) VALUES ($1,'Unit Test 1','test',50,CURRENT_DATE - 14) RETURNING id`, [cs.MATH])
  for (const [sid, m] of [[students[0], 44], [students[1], 38], [students[2], 29]]) {
    await pool.query('INSERT INTO grades (assessment_id, student_id, marks) VALUES ($1,$2,$3)', [asm.id, sid, m])
  }
  for (let d = 1; d <= 5; d++) {
    for (const [i, sid] of students.entries()) {
      const status = (d + i) % 5 === 0 ? 'absent' : 'present'
      await pool.query(`INSERT INTO attendance (student_id, class_id, date, status, marked_by) VALUES ($1,$2,CURRENT_DATE - $3::int,$4,$5) ON CONFLICT DO NOTHING`, [sid, cls.id, d, status, t1])
    }
  }
  await pool.query(`INSERT INTO assignments (class_subject_id, title, description, due_date, max_marks, created_by) VALUES ($1,'Fractions worksheet','Complete exercises 1-10 on page 42.',CURRENT_DATE + 5,20,$2)`, [cs.MATH, t1])
  await pool.query(`INSERT INTO fees (student_id, title, amount, due_date) SELECT unnest($1::int[]), 'Term 1 Tuition', 12000, CURRENT_DATE + 15`, [students])
  await pool.query(`INSERT INTO fees (student_id, title, amount, due_date) VALUES ($1,'Library deposit',1500,CURRENT_DATE - 10)`, [students[0]])
  await pool.query(`INSERT INTO announcements (title, body, audience, created_by) SELECT 'Welcome to the new term', 'Classes begin Monday at 8:30 AM. Please check the timetable.', 'all', id FROM "user" WHERE role = 'admin' LIMIT 1`)

  console.log(`Demo data created. Password for every demo account: ${PASSWORD}`)
  console.log('teacher@school.local, student@school.local, parent@school.local (+ teacher2, student2, student3, parent2)')
  await pool.end()
}

run().catch((err) => { console.error(err); process.exit(1) })
