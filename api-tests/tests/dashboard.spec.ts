import { APIRequestContext, expect, test } from '@playwright/test';
import { adminClient, call, disposeAll, makeClassroom, makeFee, makeParentOf, makeUser } from '../helpers/client';
import { daysFromToday, pastDate } from '../helpers/data';

const BUCKET = 3000;
let admin: APIRequestContext;
test.beforeAll(async () => {
  admin = await adminClient();
});
test.afterAll(disposeAll);

test('admin dashboard has the documented shape and counts grow with new users', async () => {
  const before = (await call(admin, 'GET', '/api/dashboard')).body;
  expect(before.role).toBe('admin');
  expect(Object.keys(before.counts).sort()).toEqual(['classes', 'parents', 'students', 'teachers']);
  expect(before.fees).toEqual({ billed: expect.any(Number), collected: expect.any(Number) });
  expect(Array.isArray(before.studentsByClass)).toBe(true);

  const room = await makeClassroom(admin, { students: 2 });
  await makeUser(admin, 'parent');
  const after = (await call(admin, 'GET', '/api/dashboard')).body;
  expect(after.counts.students - before.counts.students).toBe(2);
  expect(after.counts.teachers - before.counts.teachers).toBe(1);
  expect(after.counts.parents - before.counts.parents).toBe(1);
  expect(after.counts.classes - before.counts.classes).toBe(1);
  expect(after.studentsByClass.find((c: { label: string }) => c.label === `${room.className} A`)).toEqual({ label: `${room.className} A`, value: 2 });
});

test('deactivated users drop out of the admin counts', async () => {
  const before = (await call(admin, 'GET', '/api/dashboard')).body.counts.teachers;
  const t = await makeUser(admin, 'teacher');
  expect((await call(admin, 'GET', '/api/dashboard')).body.counts.teachers).toBe(before + 1);
  await call(admin, 'PATCH', `/api/users/${t.id}`, { active: false });
  expect((await call(admin, 'GET', '/api/dashboard')).body.counts.teachers).toBe(before);
});

test('teacher dashboard: classes, open assignments, and submissions awaiting grading', async () => {
  const room = await makeClassroom(admin, { students: 1 });
  let d = (await call(room.teacher.ctx, 'GET', '/api/dashboard')).body;
  expect(d).toMatchObject({ role: 'teacher', classes: 1, open_assignments: 0, to_grade: 0, today: [] });

  const a = await call(room.teacher.ctx, 'POST', '/api/assignments', { class_subject_id: room.csId, title: 'Open', due_date: daysFromToday(7), max_marks: 10 });
  await call(room.teacher.ctx, 'POST', '/api/assignments', { class_subject_id: room.csId, title: 'Closed', due_date: daysFromToday(-7), max_marks: 10 });
  d = (await call(room.teacher.ctx, 'GET', '/api/dashboard')).body;
  expect(d.open_assignments).toBe(1); // past-due ones are not "open"

  await call(room.students[0].ctx, 'POST', `/api/assignments/${a.body.id}/submit`, { content: 'done' });
  expect((await call(room.teacher.ctx, 'GET', '/api/dashboard')).body.to_grade).toBe(1);
  await call(room.teacher.ctx, 'PUT', `/api/assignments/${a.body.id}/submissions/${room.students[0].studentId}`, { marks: 9 });
  expect((await call(room.teacher.ctx, 'GET', '/api/dashboard')).body.to_grade).toBe(0);
});

test('student dashboard aggregates attendance, grades, assignments and fees exactly', async () => {
  const room = await makeClassroom(admin, { students: 1 });
  const s = room.students[0];

  const empty = (await call(s.ctx, 'GET', '/api/dashboard')).body;
  expect(empty).toMatchObject({ role: 'student', studentId: s.studentId, attendancePercentage: null, averageGrade: null, pendingAssignments: 0, outstandingFees: 0, today: [] });

  // attendance: 3 present-ish of 4 counted (+1 excused ignored) => 75%
  const statuses = ['present', 'late', 'absent', 'present', 'excused'];
  for (const [i, status] of statuses.entries()) {
    await call(room.teacher.ctx, 'PUT', `/api/attendance/class/${room.classId}`, { date: pastDate(BUCKET, i + 1), records: [{ student_id: s.studentId, status }] });
  }
  // grades: (18 + 30) / (20 + 50) = 68.571 -> 68.6
  for (const [title, max, got] of [['Q', 20, 18], ['F', 50, 30]] as const) {
    const asm = await call(room.teacher.ctx, 'POST', '/api/grades/assessments', { class_subject_id: room.csId, title, max_marks: max, date: pastDate(BUCKET, 20) });
    await call(room.teacher.ctx, 'PUT', `/api/grades/assessments/${asm.body.id}/grades`, { grades: [{ student_id: s.studentId, marks: got }] });
  }
  // assignments: two upcoming, one submitted -> 1 pending (past-due ones never count as pending)
  const a1 = await call(room.teacher.ctx, 'POST', '/api/assignments', { class_subject_id: room.csId, title: 'A1', due_date: daysFromToday(5) });
  await call(room.teacher.ctx, 'POST', '/api/assignments', { class_subject_id: room.csId, title: 'A2', due_date: daysFromToday(6) });
  await call(room.teacher.ctx, 'POST', '/api/assignments', { class_subject_id: room.csId, title: 'Old', due_date: daysFromToday(-5) });
  await call(s.ctx, 'POST', `/api/assignments/${a1.body.id}/submit`, { content: 'x' });
  // fees: 1000 + 500, paid 400 => 1100 outstanding
  const f1 = await makeFee(admin, s, { amount: 1000, title: 'F1' });
  await makeFee(admin, s, { amount: 500, title: 'F2' });
  await call(admin, 'POST', `/api/fees/${f1.id}/payments`, { amount: 400 });

  const d = (await call(s.ctx, 'GET', '/api/dashboard')).body;
  expect(d.attendancePercentage).toBe(75);
  expect(d.averageGrade).toBe(68.6);
  expect(d.pendingAssignments).toBe(1);
  expect(d.outstandingFees).toBe(1100);
});

test('parent dashboard needs a linked child and mirrors that child', async () => {
  const room = await makeClassroom(admin, { students: 2 });
  const [mine, other] = room.students;
  const parent = await makeParentOf(admin, mine);
  await makeFee(admin, mine, { amount: 250 });

  expect(await call(parent.ctx, 'GET', '/api/dashboard')).toMatchObject({ status: 400, body: { error: 'studentId is required' } });
  expect((await call(parent.ctx, 'GET', `/api/dashboard?studentId=${other.studentId}`)).status).toBe(403);
  const d = (await call(parent.ctx, 'GET', `/api/dashboard?studentId=${mine.studentId}`)).body;
  expect(d).toMatchObject({ role: 'parent', studentId: mine.studentId, outstandingFees: 250 });
});
