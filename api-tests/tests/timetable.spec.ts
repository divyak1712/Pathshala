import { APIRequestContext, expect, test } from '@playwright/test';
import { adminClient, call, disposeAll, makeClassroom, makeParentOf, makeUser } from '../helpers/client';
import { uid } from '../helpers/data';

let admin: APIRequestContext;
test.beforeAll(async () => {
  admin = await adminClient();
});
test.afterAll(disposeAll);

const period = (csId: number, over: Record<string, unknown> = {}) => ({
  class_subject_id: csId,
  day: 1,
  start_time: '09:00',
  end_time: '09:45',
  room: 'R1',
  ...over,
});

test.describe('creating periods', () => {
  test('create, list ordered by day then time, delete', async () => {
    const room = await makeClassroom(admin, { students: 1 });
    const late = await call(admin, 'POST', '/api/timetable', period(room.csId, { day: 3, start_time: '14:00', end_time: '14:30' }));
    const early = await call(admin, 'POST', '/api/timetable', period(room.csId, { day: 3, start_time: '08:00', end_time: '08:30', room: null }));
    const monday = await call(admin, 'POST', '/api/timetable', period(room.csId, { day: 1 }));
    expect([late.status, early.status, monday.status]).toEqual([201, 201, 201]);

    const rows = (await call(admin, 'GET', `/api/timetable?classId=${room.classId}`)).body;
    expect(rows.map((r: { day: number; start_time: string }) => `${r.day} ${r.start_time}`)).toEqual(['1 09:00', '3 08:00', '3 14:00']);
    expect(rows[0]).toMatchObject({
      end_time: '09:45',
      room: 'R1',
      subject: room.subjectName,
      class_name: `${room.className} A`,
      teacher_name: room.teacher.name,
      class_subject_id: room.csId,
    });
    expect(rows[1].room).toBeNull();

    expect((await call(admin, 'DELETE', `/api/timetable/${monday.body.id}`)).status).toBe(200);
    expect((await call(admin, 'GET', `/api/timetable?classId=${room.classId}`)).body).toHaveLength(2);
  });

  test('validation', async () => {
    const room = await makeClassroom(admin, { students: 0 });
    const post = (over: Record<string, unknown>) => call(admin, 'POST', '/api/timetable', period(room.csId, over));
    expect(await post({ day: 0 })).toMatchObject({ status: 400, body: { error: 'Day must be 1 (Mon) to 7 (Sun)' } });
    expect(await post({ day: 8 })).toMatchObject({ status: 400, body: { error: 'Day must be 1 (Mon) to 7 (Sun)' } });
    expect(await post({ day: 'mon' })).toMatchObject({ status: 400, body: { error: 'Day is required' } });
    expect(await post({ start_time: '9am' })).toMatchObject({ status: 400, body: { error: 'Times must be HH:MM' } });
    expect(await post({ start_time: '10:00', end_time: '10:00' })).toMatchObject({ status: 400, body: { error: 'End time must be after start time' } });
    expect(await post({ start_time: '11:00', end_time: '10:00' })).toMatchObject({ status: 400, body: { error: 'End time must be after start time' } });
    expect(await post({ class_subject_id: 'x' })).toMatchObject({ status: 400, body: { error: 'Class subject is required' } });
    expect((await call(admin, 'GET', `/api/timetable?classId=${room.classId}`)).body).toEqual([]);
  });
});

test.describe('clash detection', () => {
  test('overlap within the same class is rejected; back-to-back is allowed', async () => {
    const room = await makeClassroom(admin, { students: 0 });
    const s2 = await call(admin, 'POST', '/api/subjects', { name: `Second ${uid()}`, code: `X${uid()}` });
    const otherTeacher = await makeUser(admin, 'teacher');
    const cs2 = await call(admin, 'PUT', '/api/class-subjects', { class_id: room.classId, subject_id: s2.body.id, teacher_id: otherTeacher.id });

    expect((await call(admin, 'POST', '/api/timetable', period(room.csId))).status).toBe(201); // 09:00-09:45
    const overlap = await call(admin, 'POST', '/api/timetable', period(cs2.body.id, { start_time: '09:30', end_time: '10:15' }));
    expect(overlap).toMatchObject({ status: 409, body: { error: 'Clashes with an existing period for this class or teacher' } });
    const contained = await call(admin, 'POST', '/api/timetable', period(cs2.body.id, { start_time: '09:10', end_time: '09:20' }));
    expect(contained.status).toBe(409);
    expect((await call(admin, 'POST', '/api/timetable', period(cs2.body.id, { start_time: '09:45', end_time: '10:30' }))).status).toBe(201); // touches, doesn't overlap
    expect((await call(admin, 'POST', '/api/timetable', period(cs2.body.id, { day: 2 }))).status).toBe(201); // other day
  });

  test('the same teacher cannot be in two classes at once', async () => {
    const roomA = await makeClassroom(admin, { students: 0 });
    const roomB = await makeClassroom(admin, { students: 0 });
    // make roomA's teacher also teach roomB's subject
    await call(admin, 'PUT', '/api/class-subjects', { class_id: roomB.classId, subject_id: roomB.subjectId, teacher_id: roomA.teacher.id });

    expect((await call(admin, 'POST', '/api/timetable', period(roomA.csId, { day: 4 }))).status).toBe(201);
    expect(await call(admin, 'POST', '/api/timetable', period(roomB.csId, { day: 4, start_time: '09:15', end_time: '09:30' }))).toMatchObject({
      status: 409,
      body: { error: 'Clashes with an existing period for this class or teacher' },
    });
    // different teachers in different classes at the same time is fine
    const roomC = await makeClassroom(admin, { students: 0 });
    expect((await call(admin, 'POST', '/api/timetable', period(roomC.csId, { day: 4 }))).status).toBe(201);
  });
});

test.describe('who sees what', () => {
  test('students and parents see their class; teachers see only periods they teach', async () => {
    const room = await makeClassroom(admin, { students: 1 });
    const colleague = await makeUser(admin, 'teacher');
    const s2 = await call(admin, 'POST', '/api/subjects', { name: `Alt ${uid()}`, code: `A${uid()}` });
    const cs2 = await call(admin, 'PUT', '/api/class-subjects', { class_id: room.classId, subject_id: s2.body.id, teacher_id: colleague.id });
    await call(admin, 'POST', '/api/timetable', period(room.csId, { day: 2 }));
    await call(admin, 'POST', '/api/timetable', period(cs2.body.id, { day: 2, start_time: '10:00', end_time: '10:45' }));
    const other = await makeClassroom(admin, { students: 1 });
    await call(admin, 'POST', '/api/timetable', period(other.csId, { day: 2 }));

    const student = room.students[0];
    const parent = await makeParentOf(admin, student);
    expect((await call(student.ctx, 'GET', '/api/timetable')).body).toHaveLength(2);
    expect((await call(parent.ctx, 'GET', `/api/timetable?studentId=${student.studentId}`)).body).toHaveLength(2);
    expect((await call(room.teacher.ctx, 'GET', '/api/timetable')).body.map((r: { subject: string }) => r.subject)).toEqual([room.subjectName]);
    expect((await call(colleague.ctx, 'GET', '/api/timetable')).body.map((r: { subject: string }) => r.subject)).toEqual([s2.body.name]);
  });

  test('a parent needs a linked studentId', async () => {
    const room = await makeClassroom(admin, { students: 1 });
    const stranger = await makeUser(admin, 'parent');
    expect((await call(stranger.ctx, 'GET', '/api/timetable')).status).toBe(400);
    expect((await call(stranger.ctx, 'GET', `/api/timetable?studentId=${room.students[0].studentId}`)).status).toBe(403);
  });

  test('only admin can modify the timetable', async () => {
    const room = await makeClassroom(admin, { students: 1 });
    const created = await call(admin, 'POST', '/api/timetable', period(room.csId));
    for (const actor of [room.teacher, room.students[0]]) {
      expect((await call(actor.ctx, 'POST', '/api/timetable', period(room.csId, { day: 5 }))).status).toBe(403);
      expect((await call(actor.ctx, 'DELETE', `/api/timetable/${created.body.id}`)).status).toBe(403);
    }
    expect((await call(admin, 'GET', `/api/timetable?classId=${room.classId}`)).body).toHaveLength(1);
  });
});
