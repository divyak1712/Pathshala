import { APIRequestContext, expect, test } from '@playwright/test';
import { PASSWORD } from '../helpers/constants';
import {
  adminClient,
  call,
  checkoutCompletedEvent,
  disposeAll,
  findFee,
  makeClassroom,
  makeFee,
  makeUser,
  newClient,
  postWebhook,
  stripeSignature,
} from '../helpers/client';
import { pastDate, round2, uid, uniqueEmail } from '../helpers/data';

/**
 * Core invariants under concurrency. Over HTTP with Promise.all these are deterministic because the
 * guards are enforced inside the database (row locks, unique constraints), not by timing luck.
 */
const BUCKET = 4000;
let admin: APIRequestContext;
test.beforeAll(async () => {
  admin = await adminClient();
});
test.afterAll(disposeAll);

const count = (results: Array<{ status: number }>, status: number) => results.filter((r) => r.status === status).length;

test('fee payments never overpay: 15 concurrent payments of 100 against a 1000 balance -> exactly 10 succeed', async () => {
  const room = await makeClassroom(admin, { students: 1 });
  const title = `Race ${uid()}`;
  const fee = await makeFee(admin, room.students[0], { title, amount: 1000 });
  const results = await Promise.all(Array.from({ length: 15 }, () => call(admin, 'POST', `/api/fees/${fee.id}/payments`, { amount: 100 })));
  expect(count(results, 201)).toBe(10);
  expect(count(results, 400)).toBe(5);
  const row = await findFee(admin, room.students[0], title);
  expect(round2(row.paid)).toBe(1000);
  expect(round2(row.balance)).toBe(0);
  expect(row.status).toBe('paid');
});

test('two concurrent payments that cannot both fit: exactly one wins', async () => {
  const room = await makeClassroom(admin, { students: 1 });
  const title = `Pair ${uid()}`;
  const fee = await makeFee(admin, room.students[0], { title, amount: 1000 });
  const results = await Promise.all(Array.from({ length: 6 }, () => call(admin, 'POST', `/api/fees/${fee.id}/payments`, { amount: 600 })));
  expect(count(results, 201)).toBe(1);
  expect(count(results, 400)).toBe(5);
  expect((await findFee(admin, room.students[0], title)).paid).toBe(600);
});

test('a Stripe event delivered many times in parallel is recorded exactly once', async () => {
  const room = await makeClassroom(admin, { students: 1 });
  const title = `Hook ${uid()}`;
  const fee = await makeFee(admin, room.students[0], { title, amount: 5000 });
  const body = checkoutCompletedEvent(fee.id, 120000, `cs_test_${uid()}`);
  const sig = stripeSignature(body);
  const results = await Promise.all(Array.from({ length: 8 }, () => postWebhook(admin, body, sig)));
  expect(results.every((r) => r.status === 200)).toBe(true);
  const row = await findFee(admin, room.students[0], title);
  expect(round2(row.paid)).toBe(1200);
  const payments = (await call(room.students[0].ctx, 'GET', '/api/fees')).body[0].payments;
  expect(payments).toHaveLength(1);
});

test('the same email cannot be provisioned twice concurrently', async () => {
  const email = uniqueEmail('twin');
  const results = await Promise.all(
    Array.from({ length: 6 }, (_, i) => call(admin, 'POST', '/api/users', { name: `Twin ${i}`, email, password: PASSWORD, role: 'teacher' })),
  );
  expect(count(results, 201)).toBe(1);
  expect(count(results, 400)).toBe(5);
  const matches = (await call(admin, 'GET', '/api/users?role=teacher')).body.filter((u: { email: string }) => u.email === email);
  expect(matches).toHaveLength(1);
});

test('one admission number, many concurrent students: exactly one succeeds and the losers leave no account behind', async () => {
  const admission = `ADM-${uid()}`;
  const emails = Array.from({ length: 5 }, (_, i) => uniqueEmail(`adm${i}`));
  const results = await Promise.all(
    emails.map((email, i) =>
      call(admin, 'POST', '/api/users', { name: `Pupil ${i}`, email, password: PASSWORD, role: 'student', student: { admission_no: admission } }),
    ),
  );
  expect(count(results, 201)).toBe(1);
  expect(count(results, 409)).toBe(4);

  const survivors: string[] = [];
  for (const [i, email] of emails.entries()) {
    const ctx = await newClient();
    const res = await ctx.post('/api/auth/sign-in/email', { data: { email, password: PASSWORD } });
    if (res.ok()) survivors.push(emails[i]);
  }
  expect(survivors).toHaveLength(1); // rolled-back accounts cannot sign in
  expect(results.findIndex((r) => r.status === 201)).toBe(emails.indexOf(survivors[0]));
});

test('concurrent attendance saves for one student and day leave exactly one record', async () => {
  const room = await makeClassroom(admin, { students: 1 });
  const s = room.students[0];
  const date = pastDate(BUCKET, 1);
  const statuses = ['present', 'absent', 'late', 'excused', 'present', 'absent'];
  const results = await Promise.all(
    statuses.map((status) => call(room.teacher.ctx, 'PUT', `/api/attendance/class/${room.classId}`, { date, records: [{ student_id: s.studentId, status }] })),
  );
  expect(results.every((r) => r.status === 200)).toBe(true);
  const history = (await call(s.ctx, 'GET', '/api/attendance/student')).body.records;
  expect(history).toHaveLength(1);
  expect(statuses).toContain(history[0].status);
});

test('concurrent submissions by one student leave exactly one submission', async () => {
  const room = await makeClassroom(admin, { students: 1 });
  const s = room.students[0];
  const a = await call(room.teacher.ctx, 'POST', '/api/assignments', { class_subject_id: room.csId, title: 'Race HW', due_date: '2099-01-01' });
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => call(s.ctx, 'POST', `/api/assignments/${a.body.id}/submit`, { content: `attempt ${i}` })));
  expect(results.every((r) => r.status === 200)).toBe(true);
  const subs = (await call(room.teacher.ctx, 'GET', `/api/assignments/${a.body.id}/submissions`)).body.submissions;
  expect(subs).toHaveLength(1);
  expect(subs[0].content).toMatch(/^attempt \d$/);
});

test('overlapping timetable periods created concurrently: exactly one is accepted', async () => {
  // The clash check is a read-then-insert in application code. If this fails, two clashing periods were accepted.
  const room = await makeClassroom(admin, { students: 0 });
  const results = await Promise.all(
    Array.from({ length: 6 }, () =>
      call(admin, 'POST', '/api/timetable', { class_subject_id: room.csId, day: 6, start_time: '09:00', end_time: '09:45', room: 'R' }),
    ),
  );
  expect(count(results, 201)).toBe(1);
  expect(count(results, 409)).toBe(5);
  expect((await call(admin, 'GET', `/api/timetable?classId=${room.classId}`)).body).toHaveLength(1);
});

test('concurrent sign-ins for one user all succeed independently', async () => {
  const user = await makeUser(admin, 'teacher');
  const contexts = await Promise.all(Array.from({ length: 6 }, () => newClient()));
  const logins = await Promise.all(contexts.map((c) => c.post('/api/auth/sign-in/email', { data: { email: user.email, password: user.password } })));
  expect(logins.every((r) => r.ok())).toBe(true);
  const me = await Promise.all(contexts.map((c) => call(c, 'GET', '/api/me')));
  expect(me.every((r) => r.status === 200 && r.body.user.id === user.id)).toBe(true);
});
