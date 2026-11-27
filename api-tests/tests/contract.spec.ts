import { APIRequestContext, expect, test } from '@playwright/test';
import { PASSWORD } from '../helpers/constants';
import { adminClient, anonClient, call, disposeAll, makeClassroom, makeFee, makeParentOf, Method, postWebhook } from '../helpers/client';
import { uniqueEmail } from '../helpers/data';

let admin: APIRequestContext;
let anon: APIRequestContext;
test.beforeAll(async () => {
  admin = await adminClient();
  anon = await anonClient();
});
test.afterAll(disposeAll);

/**
 * The frontend (src/api.js) reads exactly `{ error: string }` from every failed request.
 * A route answering with any other shape silently degrades to "Request failed: NNN" in the UI.
 */
test('every known error response is JSON of exactly { error: string }', async () => {
  const room = await makeClassroom(admin, { students: 1 });
  const student = room.students[0];
  const parent = await makeParentOf(admin, student);
  const fee = await makeFee(admin, student, { amount: 100 });

  type Case = [label: string, ctx: APIRequestContext, method: Method, url: string, body: unknown, expectedStatus: number];
  const cases: Case[] = [
    ['401 anonymous', anon, 'GET', '/api/me', undefined, 401],
    ['401 anonymous on academics router', anon, 'GET', '/api/classes', undefined, 401],
    ['403 role gate', student.ctx, 'GET', '/api/users', undefined, 403],
    ['403 not your class', room.teacher.ctx, 'GET', '/api/attendance/class/999999999?date=2020-01-01', undefined, 403],
    ['403 other student', parent.ctx, 'GET', '/api/grades/student?studentId=999999999', undefined, 403],
    ['400 validation', admin, 'POST', '/api/users', { name: '', email: uniqueEmail('c'), password: PASSWORD, role: 'teacher' }, 400],
    ['400 invalid id', admin, 'DELETE', '/api/fees/abc', undefined, 400],
    ['400 missing studentId', parent.ctx, 'GET', '/api/fees', undefined, 400],
    ['404 user', admin, 'PATCH', '/api/users/does-not-exist', { name: 'x' }, 404],
    ['404 unknown api route', admin, 'GET', '/api/definitely-not-a-route', undefined, 404],
    ['409 duplicate', admin, 'POST', '/api/subjects', { name: 'dup', code: 'DUP-CONTRACT' }, 409], // second call below
    ['404 assignment', student.ctx, 'POST', '/api/assignments/999999999/submit', { content: 'x' }, 404],
    ['501 stripe unconfigured', student.ctx, 'POST', `/api/fees/${fee.id}/checkout`, {}, 501],
    ['400 payment over balance', admin, 'POST', `/api/fees/${fee.id}/payments`, { amount: 100000 }, 400],
  ];

  // make the 409 case deterministic: the first creation may succeed on a fresh DB, the second always conflicts
  await call(admin, 'POST', '/api/subjects', { name: 'dup', code: 'DUP-CONTRACT' });

  for (const [label, ctx, method, url, body, expectedStatus] of cases) {
    const res = await call(ctx, method, url, body);
    expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(expectedStatus);
    expect(res.headers['content-type'], label).toMatch(/application\/json/);
    expect(Object.keys(res.body), label).toEqual(['error']);
    expect(typeof res.body.error, label).toBe('string');
    expect(res.body.error.length, label).toBeGreaterThan(0);
  }

  const badSig = await postWebhook(anon, '{}', 't=1,v1=abc');
  expect(badSig.status).toBe(400);
  expect(badSig.body).toEqual({ error: 'Invalid signature' });
});

test('the health endpoint answers JSON', async () => {
  const res = await call(admin, 'GET', '/api/health');
  expect(res.headers['content-type']).toMatch(/application\/json/);
});

test('unknown API paths never fall through to the SPA shell', async () => {
  const res = await call(admin, 'GET', '/api/nope/at/all');
  expect(res.status).toBe(404);
  expect(res.body).toEqual({ error: 'Not found' });
  // while non-API paths do serve the app shell (HTML)
  const page = await anon.get('/login');
  expect(page.status()).toBe(200);
  expect(page.headers()['content-type']).toMatch(/text\/html/);
});

test('malformed JSON bodies produce a JSON error, not a stack trace', async () => {
  const res = await admin.fetch('/api/classes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, data: '{ not json' });
  // A client sending broken JSON is a client error (400), not a server fault (500).
  expect(res.status()).toBe(400);
  const text = await res.text();
  expect(text).not.toMatch(/\.js:\d+:\d+/); // no stack frames leaked
  expect(JSON.parse(text)).toEqual({ error: expect.any(String) });
});

test('server errors are generic and never leak internals', async () => {
  // Any 5xx must be exactly the generic envelope; probe a few awkward inputs and accept only 4xx or the generic 500.
  const probes: Array<[Method, string, unknown]> = [
    ['POST', '/api/classes', { name: 'x'.repeat(5000), academic_year: '2099' }],
    ['POST', '/api/timetable', { class_subject_id: 1e15, day: 1, start_time: '09:00', end_time: '10:00' }],
    ['GET', '/api/attendance/class/1?date=0000-00-00', undefined],
  ];
  for (const [method, url, body] of probes) {
    const res = await call(admin, method, url, body);
    if (res.status >= 500) expect(res.body).toEqual({ error: 'Internal server error' });
    else expect(typeof res.body?.error === 'string' || res.status < 400).toBe(true);
  }
});
