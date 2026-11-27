import { APIRequestContext, expect, test } from '@playwright/test';
import { adminClient, call, disposeAll, makeClassroom, makeParentOf } from '../helpers/client';
import { pastDate } from '../helpers/data';

const BUCKET = 1000; // this spec's date bucket (days in the past)
let admin: APIRequestContext;
test.beforeAll(async () => {
  admin = await adminClient();
});
test.afterAll(disposeAll);

test('unmarked students come back with a null status; saving marks them', async () => {
  const room = await makeClassroom(admin, { students: 3 });
  const date = pastDate(BUCKET, 1);
  const before = await call(room.teacher.ctx, 'GET', `/api/attendance/class/${room.classId}?date=${date}`);
  expect(before.status).toBe(200);
  expect(before.body.map((r: { roll_no: number }) => r.roll_no)).toEqual([1, 2, 3]);
  expect(before.body.every((r: { status: unknown }) => r.status === null)).toBe(true);

  const [a, b, c] = room.students;
  const save = await call(room.teacher.ctx, 'PUT', `/api/attendance/class/${room.classId}`, {
    date,
    records: [
      { student_id: a.studentId, status: 'present' },
      { student_id: b.studentId, status: 'absent' },
      { student_id: c.studentId, status: 'late' },
    ],
  });
  expect(save).toMatchObject({ status: 200, body: { saved: 3 } });

  const after = await call(room.teacher.ctx, 'GET', `/api/attendance/class/${room.classId}?date=${date}`);
  expect(after.body.map((r: { status: string }) => r.status)).toEqual(['present', 'absent', 'late']);
});

test('re-saving the same day updates rather than duplicating', async () => {
  const room = await makeClassroom(admin, { students: 1 });
  const [s] = room.students;
  const date = pastDate(BUCKET, 2);
  await call(room.teacher.ctx, 'PUT', `/api/attendance/class/${room.classId}`, { date, records: [{ student_id: s.studentId, status: 'absent' }] });
  await call(room.teacher.ctx, 'PUT', `/api/attendance/class/${room.classId}`, { date, records: [{ student_id: s.studentId, status: 'excused' }] });
  const history = await call(s.ctx, 'GET', '/api/attendance/student');
  expect(history.body.records).toEqual([{ date, status: 'excused' }]);
});

test('percentage excludes excused days and counts late as present', async () => {
  const room = await makeClassroom(admin, { students: 1 });
  const [s] = room.students;
  const days: Array<[number, string]> = [
    [3, 'present'],
    [4, 'late'],
    [5, 'absent'],
    [6, 'excused'],
  ];
  await call(room.teacher.ctx, 'PUT', `/api/attendance/class/${room.classId}`, {
    date: pastDate(BUCKET, 3),
    records: [{ student_id: s.studentId, status: 'present' }],
  });
  for (const [n, status] of days.slice(1)) {
    await call(room.teacher.ctx, 'PUT', `/api/attendance/class/${room.classId}`, {
      date: pastDate(BUCKET, n),
      records: [{ student_id: s.studentId, status }],
    });
  }
  const res = await call(s.ctx, 'GET', '/api/attendance/student');
  expect(res.status).toBe(200);
  expect(res.body.summary).toEqual({ present: 1, absent: 1, late: 1, excused: 1 });
  expect(res.body.percentage).toBe(66.7); // (present 1 + late 1) / (4 days - 1 excused)
  // newest first
  expect(res.body.records.map((r: { date: string }) => r.date)).toEqual([3, 4, 5, 6].map((n) => pastDate(BUCKET, n)));
});

test('a student with no records has a null percentage', async () => {
  const room = await makeClassroom(admin, { students: 1 });
  const res = await call(room.students[0].ctx, 'GET', '/api/attendance/student');
  expect(res.body).toEqual({ records: [], summary: { present: 0, absent: 0, late: 0, excused: 0 }, percentage: null });
});

test('validation', async () => {
  const room = await makeClassroom(admin, { students: 1 });
  const [s] = room.students;
  const url = `/api/attendance/class/${room.classId}`;
  expect(await call(room.teacher.ctx, 'PUT', url, { date: 'yesterday', records: [] })).toMatchObject({ status: 400, body: { error: 'date is required' } });
  expect(await call(room.teacher.ctx, 'PUT', url, { date: pastDate(BUCKET, 7), records: [{ student_id: s.studentId, status: 'nap' }] })).toMatchObject({
    status: 400,
    body: { error: 'Invalid status "nap"' },
  });
  expect(await call(room.teacher.ctx, 'GET', `${url}`)).toMatchObject({ status: 400, body: { error: 'date=YYYY-MM-DD is required' } });
  expect((await call(room.teacher.ctx, 'GET', '/api/attendance/class/abc?date=2020-01-01')).status).toBe(400);
});

test('a student from another class cannot be marked, and the whole batch rolls back', async () => {
  const room = await makeClassroom(admin, { students: 1 });
  const other = await makeClassroom(admin, { students: 1 });
  const date = pastDate(BUCKET, 8);
  const res = await call(room.teacher.ctx, 'PUT', `/api/attendance/class/${room.classId}`, {
    date,
    records: [
      { student_id: room.students[0].studentId, status: 'present' },
      { student_id: other.students[0].studentId, status: 'present' },
    ],
  });
  expect(res).toMatchObject({ status: 400, body: { error: 'Student does not belong to this class' } });
  // atomic: the valid first record was not persisted
  const history = await call(room.students[0].ctx, 'GET', '/api/attendance/student');
  expect(history.body.records).toEqual([]);
});

test.describe('access control', () => {
  test('teacher cannot read or write another class; admin can', async () => {
    const mine = await makeClassroom(admin, { students: 1 });
    const theirs = await makeClassroom(admin, { students: 1 });
    const date = pastDate(BUCKET, 9);
    expect(await call(mine.teacher.ctx, 'GET', `/api/attendance/class/${theirs.classId}?date=${date}`)).toMatchObject({
      status: 403,
      body: { error: 'Not your class' },
    });
    expect((await call(mine.teacher.ctx, 'PUT', `/api/attendance/class/${theirs.classId}`, { date, records: [] })).status).toBe(403);
    expect((await call(admin, 'GET', `/api/attendance/class/${theirs.classId}?date=${date}`)).status).toBe(200);
  });

  test('students and parents cannot use the class register', async () => {
    const room = await makeClassroom(admin, { students: 1 });
    const parent = await makeParentOf(admin, room.students[0]);
    for (const actor of [room.students[0], parent]) {
      const res = await call(actor.ctx, 'GET', `/api/attendance/class/${room.classId}?date=${pastDate(BUCKET, 10)}`);
      expect(res).toMatchObject({ status: 403, body: { error: 'Not allowed for your role' } });
    }
  });

  test('parents see only linked children; student ignores a foreign studentId', async () => {
    const room = await makeClassroom(admin, { students: 2 });
    const [mine, other] = room.students;
    const parent = await makeParentOf(admin, mine);
    const date = pastDate(BUCKET, 11);
    await call(room.teacher.ctx, 'PUT', `/api/attendance/class/${room.classId}`, {
      date,
      records: [
        { student_id: mine.studentId, status: 'present' },
        { student_id: other.studentId, status: 'absent' },
      ],
    });

    const own = await call(parent.ctx, 'GET', `/api/attendance/student?studentId=${mine.studentId}`);
    expect(own.body.records).toEqual([{ date, status: 'present' }]);
    expect(await call(parent.ctx, 'GET', `/api/attendance/student?studentId=${other.studentId}`)).toMatchObject({
      status: 403,
      body: { error: 'No access to this student' },
    });
    expect(await call(parent.ctx, 'GET', '/api/attendance/student')).toMatchObject({ status: 400, body: { error: 'studentId is required' } });

    // a student asking for someone else's record silently gets their own
    const sneaky = await call(mine.ctx, 'GET', `/api/attendance/student?studentId=${other.studentId}`);
    expect(sneaky.body.records).toEqual([{ date, status: 'present' }]);
  });

  test('a teacher unrelated to the class cannot read its register or its students\' history', async () => {
    const room = await makeClassroom(admin, { students: 1 });
    const stranger = (await makeClassroom(admin, { students: 0 })).teacher;
    expect((await call(stranger.ctx, 'GET', `/api/attendance/class/${room.classId}?date=${pastDate(BUCKET, 12)}`)).status).toBe(403);
    const history = await call(stranger.ctx, 'GET', `/api/attendance/student?studentId=${room.students[0].studentId}`);
    expect(history.status).toBe(403);
  });
});
