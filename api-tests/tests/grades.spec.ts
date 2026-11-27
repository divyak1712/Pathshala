import { APIRequestContext, expect, test } from '@playwright/test';
import { adminClient, call, disposeAll, makeClassroom, makeParentOf, makeUser } from '../helpers/client';
import { pastDate } from '../helpers/data';

const BUCKET = 2000;
let admin: APIRequestContext;
test.beforeAll(async () => {
  admin = await adminClient();
});
test.afterAll(disposeAll);

async function newAssessment(ctx: APIRequestContext, csId: number, over: Record<string, unknown> = {}) {
  const res = await call(ctx, 'POST', '/api/grades/assessments', {
    class_subject_id: csId,
    title: 'Unit test',
    kind: 'test',
    max_marks: 20,
    date: pastDate(BUCKET, 1),
    ...over,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as number;
}

test.describe('assessments', () => {
  test('create and list with graded counts', async () => {
    const room = await makeClassroom(admin, { students: 2 });
    const id = await newAssessment(room.teacher.ctx, room.csId, { title: 'Quiz 1', kind: 'quiz', max_marks: 25.5 });
    const list = await call(room.teacher.ctx, 'GET', `/api/grades/assessments?classSubjectId=${room.csId}`);
    expect(list.status).toBe(200);
    expect(list.body).toEqual([{ id, title: 'Quiz 1', kind: 'quiz', max_marks: 25.5, date: pastDate(BUCKET, 1), graded: 0 }]);

    await call(room.teacher.ctx, 'PUT', `/api/grades/assessments/${id}/grades`, { grades: [{ student_id: room.students[0].studentId, marks: 10 }] });
    expect((await call(room.teacher.ctx, 'GET', `/api/grades/assessments?classSubjectId=${room.csId}`)).body[0].graded).toBe(1);
  });

  test('validation', async () => {
    const room = await makeClassroom(admin, { students: 0 });
    const post = (over: Record<string, unknown>) =>
      call(room.teacher.ctx, 'POST', '/api/grades/assessments', { class_subject_id: room.csId, title: 'T', max_marks: 10, date: pastDate(BUCKET, 2), ...over });
    expect(await post({ title: '' })).toMatchObject({ status: 400, body: { error: 'Title is required' } });
    expect(await post({ kind: 'oral' })).toMatchObject({ status: 400, body: { error: 'Invalid kind' } });
    expect(await post({ max_marks: 0 })).toMatchObject({ status: 400, body: { error: 'Max marks must be positive' } });
    expect(await post({ max_marks: -5 })).toMatchObject({ status: 400, body: { error: 'Max marks must be positive' } });
    expect(await post({ max_marks: 'lots' })).toMatchObject({ status: 400, body: { error: 'Max marks is required' } });
    expect(await post({ date: '2020-02-30' })).toMatchObject({ status: 400, body: { error: 'Date is required' } });
    expect(await post({ class_subject_id: 'x' })).toMatchObject({ status: 400, body: { error: 'Class subject is required' } });
    expect(await call(room.teacher.ctx, 'GET', '/api/grades/assessments')).toMatchObject({ status: 400, body: { error: 'classSubjectId is required' } });
  });

  test('a colleague teaching another subject in the same class cannot touch it', async () => {
    const room = await makeClassroom(admin, { students: 1 });
    const colleague = await makeUser(admin, 'teacher');
    const s2 = await call(admin, 'POST', '/api/subjects', { name: `Other ${Date.now()}`, code: `O${Date.now()}` });
    await call(admin, 'PUT', '/api/class-subjects', { class_id: room.classId, subject_id: s2.body.id, teacher_id: colleague.id });

    const forbidden = { status: 403, body: { error: 'Not your subject' } };
    expect(await call(colleague.ctx, 'POST', '/api/grades/assessments', { class_subject_id: room.csId, title: 't', max_marks: 5, date: pastDate(BUCKET, 3) })).toMatchObject(forbidden);
    const id = await newAssessment(room.teacher.ctx, room.csId);
    expect(await call(colleague.ctx, 'GET', `/api/grades/assessments?classSubjectId=${room.csId}`)).toMatchObject(forbidden);
    expect(await call(colleague.ctx, 'GET', `/api/grades/assessments/${id}/grades`)).toMatchObject(forbidden);
    expect(await call(colleague.ctx, 'PUT', `/api/grades/assessments/${id}/grades`, { grades: [] })).toMatchObject(forbidden);
    expect(await call(colleague.ctx, 'DELETE', `/api/grades/assessments/${id}`)).toMatchObject(forbidden);
    // admin may
    expect((await call(admin, 'GET', `/api/grades/assessments/${id}/grades`)).status).toBe(200);
  });

  test('students and parents cannot manage assessments', async () => {
    const room = await makeClassroom(admin, { students: 1 });
    const parent = await makeParentOf(admin, room.students[0]);
    for (const actor of [room.students[0], parent]) {
      expect((await call(actor.ctx, 'POST', '/api/grades/assessments', { class_subject_id: room.csId, title: 't', max_marks: 5, date: pastDate(BUCKET, 4) })).status).toBe(403);
      expect((await call(actor.ctx, 'GET', `/api/grades/assessments?classSubjectId=${room.csId}`)).status).toBe(403);
    }
  });

  test('unknown assessment is 404', async () => {
    const room = await makeClassroom(admin, { students: 0 });
    expect(await call(room.teacher.ctx, 'GET', '/api/grades/assessments/999999999/grades')).toMatchObject({ status: 404, body: { error: 'Assessment not found' } });
  });
});

test.describe('entering marks', () => {
  test('save, update, remarks, and blank clears a mark', async () => {
    const room = await makeClassroom(admin, { students: 2 });
    const [a, b] = room.students;
    const id = await newAssessment(room.teacher.ctx, room.csId, { max_marks: 50 });

    const save = await call(room.teacher.ctx, 'PUT', `/api/grades/assessments/${id}/grades`, {
      grades: [
        { student_id: a.studentId, marks: 42.5, remarks: 'Great' },
        { student_id: b.studentId, marks: 0 },
      ],
    });
    expect(save).toMatchObject({ status: 200, body: { saved: 2 } });

    const view = await call(room.teacher.ctx, 'GET', `/api/grades/assessments/${id}/grades`);
    expect(view.body.max_marks).toBe(50);
    expect(view.body.grades).toEqual([
      { student_id: a.studentId, name: a.name, roll_no: 1, marks: 42.5, remarks: 'Great' },
      { student_id: b.studentId, name: b.name, roll_no: 2, marks: 0, remarks: null },
    ]);

    await call(room.teacher.ctx, 'PUT', `/api/grades/assessments/${id}/grades`, { grades: [{ student_id: a.studentId, marks: '' }, { student_id: b.studentId, marks: 7 }] });
    const after = (await call(room.teacher.ctx, 'GET', `/api/grades/assessments/${id}/grades`)).body.grades;
    expect(after.map((g: { marks: number | null }) => g.marks)).toEqual([null, 7]);
  });

  test('marks outside 0..max or non-numeric are rejected', async () => {
    const room = await makeClassroom(admin, { students: 1 });
    const id = await newAssessment(room.teacher.ctx, room.csId, { max_marks: 20 });
    const put = (marks: unknown) => call(room.teacher.ctx, 'PUT', `/api/grades/assessments/${id}/grades`, { grades: [{ student_id: room.students[0].studentId, marks }] });
    expect(await put(20.5)).toMatchObject({ status: 400, body: { error: 'Marks must be between 0 and 20' } });
    expect(await put(-1)).toMatchObject({ status: 400, body: { error: 'Marks must be between 0 and 20' } });
    expect(await put('abc')).toMatchObject({ status: 400, body: { error: 'Marks must be a number' } });
    expect((await put(20)).status).toBe(200); // boundary is inclusive
    expect((await put(0)).status).toBe(200);
  });

  test('a student outside the class rolls back the whole batch', async () => {
    const room = await makeClassroom(admin, { students: 1 });
    const stranger = (await makeClassroom(admin, { students: 1 })).students[0];
    const id = await newAssessment(room.teacher.ctx, room.csId);
    const res = await call(room.teacher.ctx, 'PUT', `/api/grades/assessments/${id}/grades`, {
      grades: [
        { student_id: room.students[0].studentId, marks: 10 },
        { student_id: stranger.studentId, marks: 10 },
      ],
    });
    expect(res).toMatchObject({ status: 400, body: { error: 'Student does not belong to this class' } });
    const grades = (await call(room.teacher.ctx, 'GET', `/api/grades/assessments/${id}/grades`)).body.grades;
    expect(grades[0].marks).toBeNull();
  });

  test('deleting an assessment removes its marks from report cards', async () => {
    const room = await makeClassroom(admin, { students: 1 });
    const s = room.students[0];
    const id = await newAssessment(room.teacher.ctx, room.csId);
    await call(room.teacher.ctx, 'PUT', `/api/grades/assessments/${id}/grades`, { grades: [{ student_id: s.studentId, marks: 15 }] });
    expect((await call(s.ctx, 'GET', '/api/grades/student')).body.grades).toHaveLength(1);
    expect((await call(room.teacher.ctx, 'DELETE', `/api/grades/assessments/${id}`)).status).toBe(200);
    expect((await call(s.ctx, 'GET', '/api/grades/student')).body).toEqual({ grades: [], subjects: [] });
  });
});

test.describe('report card', () => {
  test('subject percentage is total marks over total max (not an average of percentages)', async () => {
    const room = await makeClassroom(admin, { students: 1 });
    const s = room.students[0];
    const a1 = await newAssessment(room.teacher.ctx, room.csId, { title: 'Quiz', kind: 'quiz', max_marks: 20, date: pastDate(BUCKET, 10) });
    const a2 = await newAssessment(room.teacher.ctx, room.csId, { title: 'Final', kind: 'exam', max_marks: 50, date: pastDate(BUCKET, 5) });
    await call(room.teacher.ctx, 'PUT', `/api/grades/assessments/${a1}/grades`, { grades: [{ student_id: s.studentId, marks: 15, remarks: 'ok' }] });
    await call(room.teacher.ctx, 'PUT', `/api/grades/assessments/${a2}/grades`, { grades: [{ student_id: s.studentId, marks: 40 }] });

    const card = await call(s.ctx, 'GET', '/api/grades/student');
    expect(card.status).toBe(200);
    // (15 + 40) / (20 + 50) = 78.571...%  -> 78.6   (the mean of 75% and 80% would be 77.5)
    expect(card.body.subjects).toEqual([{ subject: room.subjectName, percentage: 78.6 }]);
    expect(card.body.grades).toEqual([
      { id: a2, title: 'Final', kind: 'exam', date: pastDate(BUCKET, 5), max_marks: 50, marks: 40, remarks: null, subject: room.subjectName },
      { id: a1, title: 'Quiz', kind: 'quiz', date: pastDate(BUCKET, 10), max_marks: 20, marks: 15, remarks: 'ok', subject: room.subjectName },
    ]);
  });

  test('parents see linked children only; students always get their own card', async () => {
    const room = await makeClassroom(admin, { students: 2 });
    const [mine, other] = room.students;
    const parent = await makeParentOf(admin, mine);
    const id = await newAssessment(room.teacher.ctx, room.csId);
    await call(room.teacher.ctx, 'PUT', `/api/grades/assessments/${id}/grades`, {
      grades: [
        { student_id: mine.studentId, marks: 11 },
        { student_id: other.studentId, marks: 19 },
      ],
    });
    expect((await call(parent.ctx, 'GET', `/api/grades/student?studentId=${mine.studentId}`)).body.grades[0].marks).toBe(11);
    expect(await call(parent.ctx, 'GET', `/api/grades/student?studentId=${other.studentId}`)).toMatchObject({ status: 403, body: { error: 'No access to this student' } });
    expect((await call(mine.ctx, 'GET', `/api/grades/student?studentId=${other.studentId}`)).body.grades[0].marks).toBe(11);
  });
});
