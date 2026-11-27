import { APIRequestContext, expect, test } from '@playwright/test';
import { adminClient, call, disposeAll, makeClassroom, makeParentOf, makeUser } from '../helpers/client';
import { uid } from '../helpers/data';

let admin: APIRequestContext;
test.beforeAll(async () => {
  admin = await adminClient();
});
test.afterAll(disposeAll);

const titles = async (ctx: APIRequestContext) => (await call(ctx, 'GET', '/api/announcements')).body.map((a: { title: string }) => a.title);

test.describe('posting rules', () => {
  test('admin may post school-wide to any audience; validation errors', async () => {
    for (const audience of ['all', 'teacher', 'student', 'parent']) {
      const res = await call(admin, 'POST', '/api/announcements', { title: `A ${uid()}`, body: 'b', audience });
      expect(res.status, audience).toBe(201);
      expect(res.body).toEqual({ id: expect.any(Number) });
    }
    expect(await call(admin, 'POST', '/api/announcements', { body: 'b' })).toMatchObject({ status: 400, body: { error: 'Title is required' } });
    expect(await call(admin, 'POST', '/api/announcements', { title: 't' })).toMatchObject({ status: 400, body: { error: 'Message is required' } });
    expect(await call(admin, 'POST', '/api/announcements', { title: 't', body: 'b', audience: 'aliens' })).toMatchObject({
      status: 400,
      body: { error: 'Invalid audience' },
    });
    expect(await call(admin, 'POST', '/api/announcements', { title: 't', body: 'b', class_id: 'x' })).toMatchObject({ status: 400, body: { error: 'Invalid class' } });
  });

  test('teachers must target one of their own classes and cannot address other teachers', async () => {
    const room = await makeClassroom(admin, { students: 1 });
    const other = await makeClassroom(admin, { students: 0 });
    const t = room.teacher.ctx;
    expect(await call(t, 'POST', '/api/announcements', { title: 't', body: 'b' })).toMatchObject({
      status: 403,
      body: { error: 'Teachers must pick one of their classes' },
    });
    expect(await call(t, 'POST', '/api/announcements', { title: 't', body: 'b', class_id: other.classId })).toMatchObject({
      status: 403,
      body: { error: 'Not your class' },
    });
    expect(await call(t, 'POST', '/api/announcements', { title: 't', body: 'b', class_id: room.classId, audience: 'teacher' })).toMatchObject({
      status: 403,
      body: { error: 'Teachers cannot announce to teachers' },
    });
    expect((await call(t, 'POST', '/api/announcements', { title: `ok ${uid()}`, body: 'b', class_id: room.classId, audience: 'student' })).status).toBe(201);
  });

  test('students and parents cannot post', async () => {
    const room = await makeClassroom(admin, { students: 1 });
    const parent = await makeParentOf(admin, room.students[0]);
    for (const actor of [room.students[0], parent]) {
      expect(await call(actor.ctx, 'POST', '/api/announcements', { title: 't', body: 'b' })).toMatchObject({
        status: 403,
        body: { error: 'Not allowed for your role' },
      });
    }
  });
});

test.describe('visibility matrix', () => {
  test('audience and class decide who sees what', async () => {
    const room = await makeClassroom(admin, { students: 1 });
    const other = await makeClassroom(admin, { students: 1 });
    const student = room.students[0];
    const outsider = other.students[0];
    const parent = await makeParentOf(admin, student);
    const outsiderParent = await makeParentOf(admin, outsider);
    const idle = await makeUser(admin, 'teacher'); // teaches nothing

    const tag = uid();
    const post = (ctx: APIRequestContext, name: string, body: Record<string, unknown>) =>
      call(ctx, 'POST', '/api/announcements', { title: `${name} ${tag}`, body: 'x', ...body });
    await post(admin, 'school-all', { audience: 'all' });
    await post(admin, 'school-students', { audience: 'student' });
    await post(admin, 'school-parents', { audience: 'parent' });
    await post(admin, 'school-teachers', { audience: 'teacher' });
    await post(admin, 'class-all', { audience: 'all', class_id: room.classId });
    await post(admin, 'class-parents', { audience: 'parent', class_id: room.classId });
    await post(room.teacher.ctx, 'by-teacher-students', { audience: 'student', class_id: room.classId });

    const mine = async (ctx: APIRequestContext) => (await titles(ctx)).filter((t: string) => t.endsWith(tag)).map((t: string) => t.replace(` ${tag}`, '')).sort();

    expect(await mine(student.ctx)).toEqual(['by-teacher-students', 'class-all', 'school-all', 'school-students']);
    expect(await mine(parent.ctx)).toEqual(['class-all', 'class-parents', 'school-all', 'school-parents']);
    expect(await mine(outsider.ctx)).toEqual(['school-all', 'school-students']);
    expect(await mine(outsiderParent.ctx)).toEqual(['school-all', 'school-parents']);
    // a teacher sees: all/teacher audiences for their classes or school-wide, plus anything they wrote
    expect(await mine(room.teacher.ctx)).toEqual(['by-teacher-students', 'class-all', 'school-all', 'school-teachers']);
    expect(await mine(idle.ctx)).toEqual(['school-all', 'school-teachers']);
    expect((await mine(admin)).length).toBe(7);
  });

  test('entries expose author, class name and the "mine" flag', async () => {
    const room = await makeClassroom(admin, { students: 1 });
    const title = `Meta ${uid()}`;
    await call(room.teacher.ctx, 'POST', '/api/announcements', { title, body: 'hello', class_id: room.classId, audience: 'all' });
    const own = (await call(room.teacher.ctx, 'GET', '/api/announcements')).body.find((a: { title: string }) => a.title === title);
    expect(own).toMatchObject({ author: room.teacher.name, class_name: `${room.className} A`, class_id: room.classId, audience: 'all', mine: true, body: 'hello' });
    const seenByStudent = (await call(room.students[0].ctx, 'GET', '/api/announcements')).body.find((a: { title: string }) => a.title === title);
    expect(seenByStudent.mine).toBe(false);
  });
});

test.describe('deleting', () => {
  test('teachers delete only their own; admin deletes anything; unknown is 404', async () => {
    const room = await makeClassroom(admin, { students: 1 });
    const colleague = await makeUser(admin, 'teacher');
    const mine = await call(room.teacher.ctx, 'POST', '/api/announcements', { title: `Mine ${uid()}`, body: 'b', class_id: room.classId });
    const school = await call(admin, 'POST', '/api/announcements', { title: `School ${uid()}`, body: 'b' });

    expect(await call(room.teacher.ctx, 'DELETE', `/api/announcements/${school.body.id}`)).toMatchObject({
      status: 403,
      body: { error: 'You can only delete your own announcements' },
    });
    expect((await call(colleague.ctx, 'DELETE', `/api/announcements/${mine.body.id}`)).status).toBe(403);
    expect((await call(room.students[0].ctx, 'DELETE', `/api/announcements/${mine.body.id}`)).status).toBe(403);

    expect((await call(room.teacher.ctx, 'DELETE', `/api/announcements/${mine.body.id}`)).status).toBe(200);
    expect((await call(admin, 'DELETE', `/api/announcements/${school.body.id}`)).status).toBe(200);
    expect(await call(admin, 'DELETE', `/api/announcements/${school.body.id}`)).toMatchObject({ status: 404, body: { error: 'Announcement not found' } });
    expect(await call(admin, 'DELETE', '/api/announcements/abc')).toMatchObject({ status: 400, body: { error: 'Invalid id' } });
  });
});
