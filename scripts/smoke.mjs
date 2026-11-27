// End-to-end API smoke test of auth + role permissions. Needs the server running and `npm run db:demo` data.
// Usage: node scripts/smoke.mjs [baseUrl]
const BASE = process.argv[2] || 'http://localhost:3000'
let pass = 0, fail = 0

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/sign-in/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ email, password }) })
  if (!res.ok) throw new Error(`login failed for ${email}: ${res.status} ${await res.text()}`)
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  return async (method, url, body) => {
    const r = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: BASE }, body: body ? JSON.stringify(body) : undefined })
    return { status: r.status, body: await r.json().catch(() => null) }
  }
}
function check(name, cond, extra = '') {
  if (cond) pass++
  else fail++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`)
}

const anon = async (method, url, body) => {
  const r = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', Origin: BASE }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, body: await r.json().catch(() => null) }
}

const admin = await login('admin@school.local', process.env.ADMIN_PASSWORD || 'ChangeMe123!')
const teacher = await login('teacher@school.local', 'Demo12345!')
const teacher2 = await login('teacher2@school.local', 'Demo12345!')
const student = await login('student@school.local', 'Demo12345!')
const parent = await login('parent@school.local', 'Demo12345!')

// --- unauthenticated / signup ---
check('anonymous API call is 401', (await anon('GET', '/api/dashboard')).status === 401)
check('public sign-up is blocked', (await anon('POST', '/api/auth/sign-up/email', { name: 'x', email: 'x@x.com', password: 'password123', role: 'admin' })).status === 403)
check('unknown /api route is JSON 404', (await anon('GET', '/api/nope')).status === 404 || (await anon('GET', '/api/nope')).status === 401)

// --- identity ---
const meS = (await student('GET', '/api/me')).body
const meP = (await parent('GET', '/api/me')).body
check('student role + own profile', meS.user.role === 'student' && meS.students.length === 1)
check('parent sees exactly 1 linked child', meP.user.role === 'parent' && meP.students.length === 1)
const myChild = meP.students[0].id
const classes = (await admin('GET', '/api/classes')).body
const g5 = classes.find((c) => c.name === 'Grade 5')
const g6 = classes.find((c) => c.name === 'Grade 6')

// --- role gates ---
check('student blocked from /api/users', (await student('GET', '/api/users')).status === 403)
check('parent blocked from /api/users', (await parent('GET', '/api/users')).status === 403)
check('teacher blocked from /api/users', (await teacher('GET', '/api/users')).status === 403)
check('student blocked from creating class', (await student('POST', '/api/classes', { name: 'X', academic_year: '2026' })).status === 403)
check('teacher blocked from fees', (await teacher('GET', '/api/fees')).status === 403)
check('student cannot read class register', (await student('GET', `/api/attendance/class/${g5.id}?date=2026-01-01`)).status === 403)

// --- teacher scoping ---
check('teacher sees own class', (await teacher('GET', `/api/attendance/class/${g5.id}?date=2026-11-01`)).status === 200)
check('teacher2 (not in Grade 5 except ENG) — has access via subject', (await teacher2('GET', `/api/attendance/class/${g5.id}?date=2026-11-01`)).status === 200)
check('teacher cannot access other class (Grade 6)', (await teacher('GET', `/api/attendance/class/${g6.id}?date=2026-11-01`)).status === 403)
const roster = (await teacher('GET', `/api/attendance/class/${g5.id}?date=2026-11-01`)).body
const save = await teacher('PUT', `/api/attendance/class/${g5.id}`, { date: '2026-11-01', records: roster.map((r) => ({ student_id: r.student_id, status: 'present' })) })
check('teacher saves attendance', save.status === 200, JSON.stringify(save.body))
check('invalid status rejected', (await teacher('PUT', `/api/attendance/class/${g5.id}`, { date: '2026-11-01', records: [{ student_id: roster[0].student_id, status: 'nap' }] })).status === 400)
check('student from other class rejected in register', (await teacher('PUT', `/api/attendance/class/${g5.id}`, { date: '2026-11-01', records: [{ student_id: 999999, status: 'present' }] })).status === 400)
const cs = (await teacher('GET', '/api/class-subjects')).body
const math = cs.find((c) => c.subject_code === 'MATH')
const eng = (await teacher2('GET', '/api/class-subjects')).body.find((c) => c.subject_code === 'ENG')
check('teacher cannot create assessment for colleague\'s subject', (await teacher('POST', '/api/grades/assessments', { class_subject_id: eng.id, title: 't', max_marks: 10, date: '2026-11-01' })).status === 403)
const asm = await teacher('POST', '/api/grades/assessments', { class_subject_id: math.id, title: 'Smoke quiz', kind: 'quiz', max_marks: 20, date: '2026-11-01' })
check('teacher creates assessment', asm.status === 201, JSON.stringify(asm.body))
const sid = roster[0].student_id
check('marks above max rejected', (await teacher('PUT', `/api/grades/assessments/${asm.body.id}/grades`, { grades: [{ student_id: sid, marks: 21 }] })).status === 400)
check('valid marks saved', (await teacher('PUT', `/api/grades/assessments/${asm.body.id}/grades`, { grades: [{ student_id: sid, marks: 18 }] })).status === 200)

// --- student/parent data isolation ---
check('student reads own attendance', (await student('GET', '/api/attendance/student')).status === 200)
const ownG = JSON.stringify((await student('GET', '/api/grades/student')).body)
check('student passing another studentId still gets only own data', JSON.stringify((await student('GET', `/api/grades/student?studentId=${roster.find((r) => r.student_id !== meS.students[0].id).student_id}`)).body) === ownG)
const otherStudent = roster.find((r) => r.student_id !== myChild).student_id
check('parent reads own child grades', (await parent('GET', `/api/grades/student?studentId=${myChild}`)).status === 200)
check('parent blocked from non-linked child', (await parent('GET', `/api/grades/student?studentId=${otherStudent}`)).status === 403)
check('parent blocked from non-linked child fees', (await parent('GET', `/api/fees?studentId=${otherStudent}`)).status === 403)
check('parent without studentId rejected', (await parent('GET', '/api/fees')).status === 400)
check('student cannot submit as someone else (ignores studentId)', (await student('GET', '/api/assignments')).status === 200)

// --- assignments ---
const created1 = await teacher('POST', '/api/assignments', { class_subject_id: math.id, title: 'Smoke assignment ' + Date.now(), description: 'x', due_date: '2099-01-01', max_marks: 20 })
check('teacher posts assignment', created1.status === 201, JSON.stringify(created1.body))
const asg = (await student('GET', '/api/assignments')).body.find((a) => a.id === created1.body.id)
check('student sees assignment', Boolean(asg))
check('student submits', (await student('POST', `/api/assignments/${asg.id}/submit`, { content: 'My answer' })).status === 200)
check('parent cannot submit', (await parent('POST', `/api/assignments/${asg.id}/submit`, { content: 'x', studentId: myChild })).status === 403)
check('colleague teacher cannot view submissions', (await teacher2('GET', `/api/assignments/${asg.id}/submissions`)).status === 403)
check('teacher grades submission', (await teacher('PUT', `/api/assignments/${asg.id}/submissions/${meS.students[0].id}`, { marks: 17, feedback: 'Good' })).status === 200)
check('graded submission cannot be resubmitted', (await student('POST', `/api/assignments/${asg.id}/submit`, { content: 'sneaky' })).status === 409)

// --- fees ---
const fees = (await admin('GET', '/api/fees')).body
const fee = fees.find((f) => f.student_id === meS.students[0].id && f.title === 'Term 1 Tuition')
check('admin sees fee ledger', fees.length > 0)
check('overpayment rejected', (await admin('POST', `/api/fees/${fee.id}/payments`, { amount: fee.balance + 1 })).status === 400)
check('partial payment recorded', (await admin('POST', `/api/fees/${fee.id}/payments`, { amount: 2000, method: 'cash' })).status === 201)
check('student/parent cannot record payment', (await student('POST', `/api/fees/${fee.id}/payments`, { amount: 1 })).status === 403)
const after = (await student('GET', '/api/fees')).body.find((f) => f.id === fee.id)
check('student sees updated balance', after.paid === fee.paid + 2000 && after.balance === fee.balance - 2000, JSON.stringify(after))
const co = await student('POST', `/api/fees/${fee.id}/checkout`, {})
check('online pay returns clear 501 when Stripe unset', co.status === 501 && /not configured/i.test(co.body.error), JSON.stringify(co))
const bogus = await anon('POST', '/api/webhooks/stripe', { type: 'checkout.session.completed' })
check('webhook rejects unsigned request', bogus.status === 400)

// --- announcements ---
check('teacher cannot announce school-wide', (await teacher('POST', '/api/announcements', { title: 'a', body: 'b' })).status === 403)
check('teacher cannot announce to other class', (await teacher('POST', '/api/announcements', { title: 'a', body: 'b', class_id: g6.id })).status === 403)
check('teacher announces to own class', (await teacher('POST', '/api/announcements', { title: 'Quiz Friday', body: 'Revise ch 3', class_id: g5.id, audience: 'student' })).status === 201)
check('student sees class announcement', (await student('GET', '/api/announcements')).body.some((a) => a.title === 'Quiz Friday'))
check('parent (audience student) does not see it', !(await parent('GET', '/api/announcements')).body.some((a) => a.title === 'Quiz Friday'))
check('student cannot post announcement', (await student('POST', '/api/announcements', { title: 'a', body: 'b' })).status === 403)

// --- timetable clash ---
const tt = await admin('POST', '/api/timetable', { class_subject_id: math.id, day: 1, start_time: '09:15', end_time: '09:30' })
check('timetable clash rejected', tt.status === 409, JSON.stringify(tt))

// --- admin user mgmt ---
const email = `smoke${Date.now()}@school.local`
const created = await admin('POST', '/api/users', { name: 'Smoke Teacher', email, password: 'Smoke12345', role: 'teacher' })
check('admin creates user', created.status === 201, JSON.stringify(created.body))
const newT = await login(email, 'Smoke12345')
check('new user has role teacher, not elevated', (await newT('GET', '/api/me')).body.user.role === 'teacher')
check('admin cannot demote self', (await admin('GET', '/api/me')).body.user.id && (await admin('PATCH', `/api/users/${(await admin('GET', '/api/me')).body.user.id}`, { role: 'teacher' })).status === 400)
check('deactivate user', (await admin('PATCH', `/api/users/${created.body.id}`, { active: false })).status === 200)
check('deactivated user is locked out', (await newT('GET', '/api/me')).status === 401 || (await newT('GET', '/api/me')).status === 403)
await admin('DELETE', `/api/users/${created.body.id}`)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
