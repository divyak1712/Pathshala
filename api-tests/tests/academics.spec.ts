import { APIRequestContext, expect, test } from '@playwright/test';
import { adminClient, call, disposeAll, makeClassroom, makeUser } from '../helpers/client';
import { uid } from '../helpers/data';

let admin: APIRequestContext;
test.beforeAll(async () => {
  admin = await adminClient();
});
test.afterAll(disposeAll);

test.describe('classes', () => {
  test('create applies defaults and appears with teacher name and student count', async () => {
    const teacher = await makeUser(admin, 'teacher');
    const name = `Class ${uid()}`;
    const res = await call(admin, 'POST', '/api/classes', { name, academic_year: '2099-00', class_teacher_id: teacher.id });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name, section: 'A', academic_year: '2099-00', class_teacher_id: teacher.id });

    const list = await call(admin, 'GET', '/api/classes');
    expect(list.body.find((c: { id: number }) => c.id === res.body.id)).toMatchObject({
      class_teacher_name: teacher.name,
      student_count: 0,
    });
  });

  test('validation and uniqueness', async () => {
    expect(await call(admin, 'POST', '/api/classes', { academic_year: '2099' })).toMatchObject({ status: 400, body: { error: 'Class name is required' } });
    expect(await call(admin, 'POST', '/api/classes', { name: 'X' })).toMatchObject({ status: 400, body: { error: 'Academic year is required' } });
    const name = `Dup ${uid()}`;
    expect((await call(admin, 'POST', '/api/classes', { name, section: 'B', academic_year: '2099' })).status).toBe(201);
    const dup = await call(admin, 'POST', '/api/classes', { name, section: 'B', academic_year: '2099' });
    expect(dup.status).toBe(409);
    expect(dup.body).toEqual({ error: 'That record already exists' });
    // same name, different section is fine
    expect((await call(admin, 'POST', '/api/classes', { name, section: 'C', academic_year: '2099' })).status).toBe(201);
  });

  test('update and delete; unknown class is 404', async () => {
    const created = await call(admin, 'POST', '/api/classes', { name: `Up ${uid()}`, academic_year: '2099' });
    const id = created.body.id;
    expect((await call(admin, 'PATCH', `/api/classes/${id}`, { name: 'Renamed Class', section: 'Z' })).status).toBe(200);
    const row = (await call(admin, 'GET', '/api/classes')).body.find((c: { id: number }) => c.id === id);
    expect(row).toMatchObject({ name: 'Renamed Class', section: 'Z' });

    expect(await call(admin, 'PATCH', '/api/classes/999999999', { name: 'x' })).toMatchObject({ status: 404, body: { error: 'Class not found' } });
    expect(await call(admin, 'PATCH', '/api/classes/abc', { name: 'x' })).toMatchObject({ status: 400, body: { error: 'Invalid class' } });

    expect((await call(admin, 'DELETE', `/api/classes/${id}`)).status).toBe(200);
    expect((await call(admin, 'GET', '/api/classes')).body.some((c: { id: number }) => c.id === id)).toBe(false);
  });

  test('teachers only see classes they are responsible for; admin sees all', async () => {
    const a = await makeClassroom(admin, { students: 1 });
    const b = await makeClassroom(admin, { students: 1 });
    const seenByA = (await call(a.teacher.ctx, 'GET', '/api/classes')).body.map((c: { id: number }) => c.id);
    expect(seenByA).toContain(a.classId);
    expect(seenByA).not.toContain(b.classId);
    const seenByAdmin = (await call(admin, 'GET', '/api/classes')).body.map((c: { id: number }) => c.id);
    expect(seenByAdmin).toEqual(expect.arrayContaining([a.classId, b.classId]));
    expect((await call(admin, 'GET', '/api/classes')).body.find((c: { id: number }) => c.id === a.classId).student_count).toBe(1);
  });

  test('students and parents cannot read or change classes', async () => {
    const room = await makeClassroom(admin, { students: 1 });
    const student = room.students[0];
    expect(await call(student.ctx, 'GET', '/api/classes')).toMatchObject({ status: 403, body: { error: 'Not allowed for your role' } });
    expect((await call(student.ctx, 'POST', '/api/classes', { name: 'x', academic_year: '1' })).status).toBe(403);
    expect((await call(room.teacher.ctx, 'POST', '/api/classes', { name: 'x', academic_year: '1' })).status).toBe(403);
    expect((await call(room.teacher.ctx, 'DELETE', `/api/classes/${room.classId}`)).status).toBe(403);
  });
});

test.describe('subjects', () => {
  test('create upper-cases the code; duplicates and missing fields are rejected', async () => {
    const code = `s${uid()}`;
    const res = await call(admin, 'POST', '/api/subjects', { name: `Sub ${uid()}`, code });
    expect(res.status).toBe(201);
    expect(res.body.code).toBe(code.toUpperCase());

    const dupCode = await call(admin, 'POST', '/api/subjects', { name: `Other ${uid()}`, code });
    expect(dupCode.status).toBe(409);
    expect(await call(admin, 'POST', '/api/subjects', { code: 'X' })).toMatchObject({ status: 400, body: { error: 'Subject name is required' } });
    expect(await call(admin, 'POST', '/api/subjects', { name: 'X' })).toMatchObject({ status: 400, body: { error: 'Subject code is required' } });
  });

  test('delete, and teachers may list but not manage', async () => {
    const teacher = await makeUser(admin, 'teacher');
    const s = await call(admin, 'POST', '/api/subjects', { name: `Del ${uid()}`, code: `D${uid()}` });
    expect((await call(teacher.ctx, 'GET', '/api/subjects')).status).toBe(200);
    expect((await call(teacher.ctx, 'POST', '/api/subjects', { name: 'n', code: 'c' })).status).toBe(403);
    expect((await call(teacher.ctx, 'DELETE', `/api/subjects/${s.body.id}`)).status).toBe(403);
    expect((await call(admin, 'DELETE', `/api/subjects/${s.body.id}`)).status).toBe(200);
    expect((await call(admin, 'GET', '/api/subjects')).body.some((x: { id: number }) => x.id === s.body.id)).toBe(false);
  });
});

test.describe('teaching assignments (class_subjects)', () => {
  test('assigning is an upsert: reassigning a subject changes its teacher', async () => {
    const room = await makeClassroom(admin, { students: 0 });
    const other = await makeUser(admin, 'teacher');
    const res = await call(admin, 'PUT', '/api/class-subjects', { class_id: room.classId, subject_id: room.subjectId, teacher_id: other.id });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(room.csId); // same row, not a duplicate

    const rows = (await call(admin, 'GET', `/api/class-subjects?classId=${room.classId}`)).body;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ teacher_id: other.id, teacher_name: other.name, subject_name: room.subjectName });
  });

  test('a teacher sees only the subjects they themselves teach', async () => {
    const room = await makeClassroom(admin, { students: 0 });
    const colleague = await makeUser(admin, 'teacher');
    const subject2 = await call(admin, 'POST', '/api/subjects', { name: `S2 ${uid()}`, code: `T${uid()}` });
    const cs2 = await call(admin, 'PUT', '/api/class-subjects', { class_id: room.classId, subject_id: subject2.body.id, teacher_id: colleague.id });

    const mine = (await call(room.teacher.ctx, 'GET', '/api/class-subjects')).body.map((r: { id: number }) => r.id);
    expect(mine).toContain(room.csId);
    expect(mine).not.toContain(cs2.body.id);

    const colleagueSees = (await call(colleague.ctx, 'GET', '/api/class-subjects')).body.map((r: { id: number }) => r.id);
    expect(colleagueSees).toEqual([cs2.body.id]);
  });

  test('validation, removal and role gates', async () => {
    const room = await makeClassroom(admin, { students: 1 });
    expect(await call(admin, 'PUT', '/api/class-subjects', { subject_id: room.subjectId })).toMatchObject({ status: 400, body: { error: 'Class is required' } });
    expect(await call(admin, 'PUT', '/api/class-subjects', { class_id: room.classId })).toMatchObject({ status: 400, body: { error: 'Subject is required' } });
    expect((await call(room.teacher.ctx, 'PUT', '/api/class-subjects', { class_id: room.classId, subject_id: room.subjectId })).status).toBe(403);
    expect((await call(room.students[0].ctx, 'GET', '/api/class-subjects')).status).toBe(403);
    expect((await call(room.teacher.ctx, 'DELETE', `/api/class-subjects/${room.csId}`)).status).toBe(403);
    expect((await call(admin, 'DELETE', `/api/class-subjects/${room.csId}`)).status).toBe(200);
    expect((await call(admin, 'GET', `/api/class-subjects?classId=${room.classId}`)).body).toEqual([]);
  });
});

test.describe('student roster and placement', () => {
  test('teacher sees only own-class students and gets 403 for other classes', async () => {
    const a = await makeClassroom(admin, { students: 2 });
    const b = await makeClassroom(admin, { students: 1 });
    const own = (await call(a.teacher.ctx, 'GET', '/api/students')).body.map((s: { id: number }) => s.id);
    expect(own).toEqual(expect.arrayContaining(a.students.map((s) => s.studentId)));
    expect(own).not.toContain(b.students[0].studentId);

    expect(await call(a.teacher.ctx, 'GET', `/api/students?classId=${b.classId}`)).toMatchObject({ status: 403, body: { error: 'Not your class' } });
    const filtered = await call(a.teacher.ctx, 'GET', `/api/students?classId=${a.classId}`);
    expect(filtered.body.map((s: { roll_no: number }) => s.roll_no)).toEqual([1, 2]); // ordered by roll number
  });

  test('admin moves a student between classes and edits profile fields', async () => {
    const a = await makeClassroom(admin, { students: 1 });
    const b = await makeClassroom(admin, { students: 0 });
    const s = a.students[0];
    const res = await call(admin, 'PATCH', `/api/students/${s.studentId}`, { class_id: b.classId, roll_no: 9, dob: '2012-03-04', phone: '555-0100' });
    expect(res.status).toBe(200);

    const roster = (await call(admin, 'GET', `/api/students?classId=${b.classId}`)).body;
    expect(roster).toHaveLength(1);
    expect(roster[0]).toMatchObject({ id: s.studentId, roll_no: 9, dob: '2012-03-04', phone: '555-0100' });
    expect((await call(admin, 'GET', `/api/students?classId=${a.classId}`)).body).toEqual([]);
    // the student's own view follows the move
    expect((await call(s.ctx, 'GET', '/api/me')).body.students[0].class_id).toBe(b.classId);
  });

  test('student patch validation and role gates', async () => {
    const room = await makeClassroom(admin, { students: 1 });
    const s = room.students[0];
    expect(await call(admin, 'PATCH', `/api/students/${s.studentId}`, { dob: '2012-13-45' })).toMatchObject({ status: 400, body: { error: 'Invalid date of birth' } });
    expect(await call(admin, 'PATCH', '/api/students/999999999', { class_id: room.classId })).toMatchObject({ status: 404, body: { error: 'Student not found' } });
    expect((await call(room.teacher.ctx, 'PATCH', `/api/students/${s.studentId}`, { class_id: null })).status).toBe(403);
    expect((await call(s.ctx, 'GET', '/api/students')).status).toBe(403);
  });
});
