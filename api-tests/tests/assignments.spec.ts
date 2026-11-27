import { APIRequestContext, expect, test } from '@playwright/test';
import { adminClient, call, disposeAll, makeClassroom, makeParentOf, makeUser } from '../helpers/client';
import { daysFromToday, uid } from '../helpers/data';

let admin: APIRequestContext;
test.beforeAll(async () => {
  admin = await adminClient();
});
test.afterAll(disposeAll);

async function post(ctx: APIRequestContext, csId: number, over: Record<string, unknown> = {}) {
  const res = await call(ctx, 'POST', '/api/assignments', {
    class_subject_id: csId,
    title: `HW ${uid()}`,
    description: 'Do the thing',
    due_date: daysFromToday(30),
    max_marks: 20,
    ...over,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as number;
}

test.describe('posting', () => {
  test('teacher posts; defaults max marks to 10; student sees it with no submission', async () => {
    const room = await makeClassroom(admin, { students: 1 });
    const id = await post(room.teacher.ctx, room.csId, { max_marks: undefined, title: 'Defaults' });
    const seen = (await call(room.students[0].ctx, 'GET', '/api/assignments')).body;
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      id,
      title: 'Defaults',
      max_marks: 10,
      subject: room.subjectName,
      class_name: `${room.className} A`,
      submission: null,
      marks: null,
      feedback: null,
    });
  });

  test('validation', async () => {
    const room = await makeClassroom(admin, { students: 0 });
    const bad = (over: Record<string, unknown>) =>
      call(room.teacher.ctx, 'POST', '/api/assignments', { class_subject_id: room.csId, title: 'T', due_date: daysFromToday(5), ...over });
    expect(await bad({ title: ' ' })).toMatchObject({ status: 400, body: { error: 'Title is required' } });
    expect(await bad({ due_date: 'soon' })).toMatchObject({ status: 400, body: { error: 'Due date is required' } });
    expect(await bad({ max_marks: 'x' })).toMatchObject({ status: 400, body: { error: 'Invalid max marks' } });
    expect(await bad({ class_subject_id: 'x' })).toMatchObject({ status: 400, body: { error: 'Class subject is required' } });
  });

  test('only the subject teacher (or admin) may post, view submissions, grade or delete', async () => {
    const room = await makeClassroom(admin, { students: 1 });
    const colleague = await makeUser(admin, 'teacher');
    const id = await post(room.teacher.ctx, room.csId);
    const denied = { status: 403, body: { error: 'Not your subject' } };

    expect(await call(colleague.ctx, 'POST', '/api/assignments', { class_subject_id: room.csId, title: 't', due_date: daysFromToday(3) })).toMatchObject(denied);
    expect(await call(colleague.ctx, 'GET', `/api/assignments/${id}/submissions`)).toMatchObject(denied);
    expect(await call(colleague.ctx, 'DELETE', `/api/assignments/${id}`)).toMatchObject(denied);
    expect((await call(colleague.ctx, 'GET', '/api/assignments')).body).toEqual([]); // not listed either
    expect((await call(room.teacher.ctx, 'GET', '/api/assignments')).body.map((a: { id: number }) => a.id)).toContain(id);
    expect((await call(admin, 'GET', `/api/assignments/${id}/submissions`)).status).toBe(200);
  });

  test('students and parents cannot post or delete', async () => {
    const room = await makeClassroom(admin, { students: 1 });
    const parent = await makeParentOf(admin, room.students[0]);
    const id = await post(room.teacher.ctx, room.csId);
    for (const actor of [room.students[0], parent]) {
      expect((await call(actor.ctx, 'POST', '/api/assignments', { class_subject_id: room.csId, title: 't', due_date: daysFromToday(3) })).status).toBe(403);
      expect((await call(actor.ctx, 'DELETE', `/api/assignments/${id}`)).status).toBe(403);
      expect((await call(actor.ctx, 'GET', `/api/assignments/${id}/submissions`)).status).toBe(403);
    }
  });

  test('delete removes it from the student feed; unknown id is 404', async () => {
    const room = await makeClassroom(admin, { students: 1 });
    const id = await post(room.teacher.ctx, room.csId);
    expect((await call(room.teacher.ctx, 'DELETE', `/api/assignments/${id}`)).status).toBe(200);
    expect((await call(room.students[0].ctx, 'GET', '/api/assignments')).body).toEqual([]);
    expect(await call(room.teacher.ctx, 'DELETE', `/api/assignments/${id}`)).toMatchObject({ status: 404, body: { error: 'Assignment not found' } });
  });

  test('a student only sees their own class\'s assignments', async () => {
    const mine = await makeClassroom(admin, { students: 1 });
    const theirs = await makeClassroom(admin, { students: 1 });
    const id = await post(theirs.teacher.ctx, theirs.csId);
    expect((await call(mine.students[0].ctx, 'GET', '/api/assignments')).body.some((a: { id: number }) => a.id === id)).toBe(false);
  });
});

test.describe('submission and grading lifecycle', () => {
  test('submit, resubmit before grading, grade, then locked', async () => {
    const room = await makeClassroom(admin, { students: 2 });
    const [s, quiet] = room.students;
    const id = await post(room.teacher.ctx, room.csId, { max_marks: 20 });

    // empty content rejected
    expect(await call(s.ctx, 'POST', `/api/assignments/${id}/submit`, { content: '   ' })).toMatchObject({ status: 400, body: { error: 'Submission cannot be empty' } });

    expect((await call(s.ctx, 'POST', `/api/assignments/${id}/submit`, { content: 'first try' })).status).toBe(200);
    expect((await call(s.ctx, 'POST', `/api/assignments/${id}/submit`, { content: 'second try' })).status).toBe(200);
    expect((await call(s.ctx, 'GET', '/api/assignments')).body[0].submission).toBe('second try');

    const list = (await call(room.teacher.ctx, 'GET', `/api/assignments/${id}/submissions`)).body;
    expect(list.max_marks).toBe(20);
    expect(list.submissions).toHaveLength(2);
    expect(list.submissions.find((x: { student_id: number }) => x.student_id === s.studentId)).toMatchObject({ content: 'second try', marks: null, feedback: null });
    expect(list.submissions.find((x: { student_id: number }) => x.student_id === quiet.studentId)).toMatchObject({ content: null, marks: null });
    expect((await call(room.teacher.ctx, 'GET', '/api/assignments')).body.find((a: { id: number }) => a.id === id).submitted).toBe(1);

    // grading
    const grade = await call(room.teacher.ctx, 'PUT', `/api/assignments/${id}/submissions/${s.studentId}`, { marks: 17.5, feedback: 'Nice work' });
    expect(grade.status).toBe(200);
    expect((await call(s.ctx, 'GET', '/api/assignments')).body[0]).toMatchObject({ marks: 17.5, feedback: 'Nice work', submission: 'second try' });

    // locked after grading
    expect(await call(s.ctx, 'POST', `/api/assignments/${id}/submit`, { content: 'sneaky edit' })).toMatchObject({
      status: 409,
      body: { error: 'Already graded; cannot resubmit' },
    });
    expect((await call(s.ctx, 'GET', '/api/assignments')).body[0].submission).toBe('second try');
  });

  test('grading validation', async () => {
    const room = await makeClassroom(admin, { students: 2 });
    const [s, noSubmission] = room.students;
    const id = await post(room.teacher.ctx, room.csId, { max_marks: 10 });
    await call(s.ctx, 'POST', `/api/assignments/${id}/submit`, { content: 'x' });
    const url = (sid: number | undefined) => `/api/assignments/${id}/submissions/${sid}`;

    expect(await call(room.teacher.ctx, 'PUT', url(s.studentId), { marks: 10.5 })).toMatchObject({ status: 400, body: { error: 'Marks must be between 0 and 10' } });
    expect(await call(room.teacher.ctx, 'PUT', url(s.studentId), { marks: -1 })).toMatchObject({ status: 400, body: { error: 'Marks must be between 0 and 10' } });
    expect(await call(room.teacher.ctx, 'PUT', url(s.studentId), { marks: 'A+' })).toMatchObject({ status: 400, body: { error: 'Marks must be a number' } });
    expect(await call(room.teacher.ctx, 'PUT', url(noSubmission.studentId), { marks: 5 })).toMatchObject({ status: 404, body: { error: 'No submission from this student' } });
    expect((await call(room.teacher.ctx, 'PUT', url(s.studentId), { marks: 10 })).status).toBe(200); // inclusive max
  });

  test('students can only submit work for their own class; parents cannot submit at all', async () => {
    const room = await makeClassroom(admin, { students: 1 });
    const outsider = (await makeClassroom(admin, { students: 1 })).students[0];
    const parent = await makeParentOf(admin, room.students[0]);
    const id = await post(room.teacher.ctx, room.csId);

    expect(await call(outsider.ctx, 'POST', `/api/assignments/${id}/submit`, { content: 'not mine' })).toMatchObject({
      status: 403,
      body: { error: 'This assignment is not for your class' },
    });
    expect((await call(parent.ctx, 'POST', `/api/assignments/${id}/submit`, { content: 'x', studentId: room.students[0].studentId })).status).toBe(403);
    expect((await call(admin, 'POST', `/api/assignments/${id}/submit`, { content: 'x' })).status).toBe(403);
    expect((await call(room.teacher.ctx, 'GET', `/api/assignments/${id}/submissions`)).body.submissions[0].content).toBeNull();
  });

  test('parent sees the child\'s submission and grade, scoped to linked children', async () => {
    const room = await makeClassroom(admin, { students: 2 });
    const [mine, other] = room.students;
    const parent = await makeParentOf(admin, mine);
    const id = await post(room.teacher.ctx, room.csId);
    await call(mine.ctx, 'POST', `/api/assignments/${id}/submit`, { content: 'child answer' });
    await call(room.teacher.ctx, 'PUT', `/api/assignments/${id}/submissions/${mine.studentId}`, { marks: 12, feedback: 'ok' });

    const view = await call(parent.ctx, 'GET', `/api/assignments?studentId=${mine.studentId}`);
    expect(view.body[0]).toMatchObject({ submission: 'child answer', marks: 12, feedback: 'ok' });
    expect((await call(parent.ctx, 'GET', `/api/assignments?studentId=${other.studentId}`)).status).toBe(403);
    expect((await call(parent.ctx, 'GET', '/api/assignments')).status).toBe(400);
  });
});
