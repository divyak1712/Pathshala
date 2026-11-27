import { APIRequestContext, expect, test } from '@playwright/test';
import {
  adminClient,
  call,
  checkoutCompletedEvent,
  disposeAll,
  findFee,
  makeClassroom,
  makeFee,
  makeParentOf,
  makeUser,
  postWebhook,
  stripeSignature,
} from '../helpers/client';
import { daysFromToday, round2, uid } from '../helpers/data';

let admin: APIRequestContext;
test.beforeAll(async () => {
  admin = await adminClient();
});
test.afterAll(disposeAll);

test.describe('billing', () => {
  test('bill one student; bill a whole class creates one fee per student', async () => {
    const room = await makeClassroom(admin, { students: 3 });
    const single = await call(admin, 'POST', '/api/fees', { student_id: room.students[0].studentId, title: 'Single', amount: 500, due_date: daysFromToday(10) });
    expect(single).toMatchObject({ status: 201, body: { created: 1 } });

    const bulk = await call(admin, 'POST', '/api/fees', { class_id: room.classId, title: 'Bulk', amount: 1200.5, due_date: daysFromToday(10) });
    expect(bulk).toMatchObject({ status: 201, body: { created: 3 } });

    for (const s of room.students) {
      const mine = (await call(s.ctx, 'GET', '/api/fees')).body;
      expect(mine.map((f: { title: string }) => f.title).sort()).toEqual(s === room.students[0] ? ['Bulk', 'Single'] : ['Bulk']);
    }
    const bulkRow = (await call(room.students[1].ctx, 'GET', '/api/fees')).body[0];
    expect(bulkRow).toMatchObject({ title: 'Bulk', amount: 1200.5, paid: 0, balance: 1200.5, status: 'pending', payments: [] });
  });

  test('validation', async () => {
    const room = await makeClassroom(admin, { students: 1 });
    const empty = await makeClassroom(admin, { students: 0 });
    const base = { student_id: room.students[0].studentId, title: 'T', amount: 100, due_date: daysFromToday(5) };
    const post = (over: Record<string, unknown>) => call(admin, 'POST', '/api/fees', { ...base, ...over });
    expect(await post({ title: '' })).toMatchObject({ status: 400, body: { error: 'Title is required' } });
    expect(await post({ amount: undefined })).toMatchObject({ status: 400, body: { error: 'Amount is required' } });
    expect(await post({ amount: 0 })).toMatchObject({ status: 400, body: { error: 'Amount must be positive' } });
    expect(await post({ amount: -50 })).toMatchObject({ status: 400, body: { error: 'Amount must be positive' } });
    expect(await post({ due_date: 'later' })).toMatchObject({ status: 400, body: { error: 'Due date is required' } });
    expect(await post({ student_id: undefined })).toMatchObject({ status: 400, body: { error: 'Select a student or a class' } });
    expect(await post({ student_id: undefined, class_id: empty.classId })).toMatchObject({ status: 400, body: { error: 'That class has no students' } });
    expect((await call(room.students[0].ctx, 'GET', '/api/fees')).body).toEqual([]);
  });

  test('deleting a fee removes it and its payments', async () => {
    const room = await makeClassroom(admin, { students: 1 });
    const fee = await makeFee(admin, room.students[0], { amount: 300 });
    await call(admin, 'POST', `/api/fees/${fee.id}/payments`, { amount: 100 });
    expect((await call(admin, 'DELETE', `/api/fees/${fee.id}`)).status).toBe(200);
    expect((await call(room.students[0].ctx, 'GET', '/api/fees')).body).toEqual([]);
  });
});

test.describe('payments and status', () => {
  test('money math with awkward amounts; status moves pending -> paid; overpayment rejected', async () => {
    const room = await makeClassroom(admin, { students: 1 });
    const student = room.students[0];
    const title = `Tuition ${uid()}`;
    const fee = await makeFee(admin, student, { title, amount: 1234.56, due_date: daysFromToday(20) });
    expect(fee).toMatchObject({ amount: 1234.56, paid: 0, balance: 1234.56, status: 'pending' });

    const p1 = await call(admin, 'POST', `/api/fees/${fee.id}/payments`, { amount: 200.1, method: 'upi' });
    expect(p1.status).toBe(201);
    let row = await findFee(admin, student, title);
    expect(row.paid).toBeCloseTo(200.1, 2);
    expect(round2(row.balance)).toBe(1034.46);
    expect(row.status).toBe('pending');

    const over = await call(admin, 'POST', `/api/fees/${fee.id}/payments`, { amount: 1034.47 });
    expect(over).toMatchObject({ status: 400, body: { error: 'Amount exceeds outstanding balance (1034.46)' } });
    expect((await findFee(admin, student, title)).paid).toBeCloseTo(200.1, 2); // nothing recorded

    const rest = await call(admin, 'POST', `/api/fees/${fee.id}/payments`, { amount: 1034.46 });
    expect(rest.status).toBe(201);
    row = await findFee(admin, student, title);
    expect(round2(row.paid)).toBe(1234.56);
    expect(round2(row.balance)).toBe(0);
    expect(row.status).toBe('paid');

    expect(await call(admin, 'POST', `/api/fees/${fee.id}/payments`, { amount: 0.01 })).toMatchObject({
      status: 400,
      body: { error: 'Amount exceeds outstanding balance (0)' },
    });

    // the student's own view lists both payments, newest first, with the method used
    const mine = (await call(student.ctx, 'GET', '/api/fees')).body.find((f: { id: number }) => f.id === fee.id);
    expect(mine.payments.map((p: { amount: number; method: string }) => [p.amount, p.method])).toEqual([
      [1034.46, 'cash'],
      [200.1, 'upi'],
    ]);
  });

  test('payment validation', async () => {
    const room = await makeClassroom(admin, { students: 1 });
    const title = `PayVal ${uid()}`;
    const fee = await makeFee(admin, room.students[0], { title, amount: 100 });
    const pay = (body: unknown) => call(admin, 'POST', `/api/fees/${fee.id}/payments`, body);
    expect(await pay({})).toMatchObject({ status: 400, body: { error: 'Amount is required' } });
    expect(await pay({ amount: 'ten' })).toMatchObject({ status: 400, body: { error: 'Amount is required' } });
    expect(await pay({ amount: 0 })).toMatchObject({ status: 400, body: { error: 'Amount must be positive' } });
    expect(await pay({ amount: -5 })).toMatchObject({ status: 400, body: { error: 'Amount must be positive' } });
    expect(await call(admin, 'POST', '/api/fees/999999999/payments', { amount: 5 })).toMatchObject({ status: 404, body: { error: 'Fee not found' } });
    expect((await findFee(admin, room.students[0], title)).paid).toBe(0); // nothing was recorded by any of the above
  });

  test('a past-due unpaid fee is overdue; paying it off clears the status', async () => {
    const room = await makeClassroom(admin, { students: 1 });
    const title = `Late ${uid()}`;
    const fee = await makeFee(admin, room.students[0], { title, amount: 80, due_date: daysFromToday(-3) });
    expect(fee.status).toBe('overdue');
    expect((await call(admin, 'GET', '/api/fees?status=overdue')).body.some((f: { id: number }) => f.id === fee.id)).toBe(true);
    expect((await call(admin, 'GET', '/api/fees?status=pending')).body.some((f: { id: number }) => f.id === fee.id)).toBe(false);
    await call(admin, 'POST', `/api/fees/${fee.id}/payments`, { amount: 80 });
    expect((await findFee(admin, room.students[0], title)).status).toBe('paid');
    expect((await call(admin, 'GET', '/api/fees?status=paid')).body.some((f: { id: number }) => f.id === fee.id)).toBe(true);
  });

  test('admin summary moves by exactly the billed, collected, outstanding and overdue amounts', async () => {
    const room = await makeClassroom(admin, { students: 1 });
    const before = (await call(admin, 'GET', '/api/fees/summary')).body;
    const current = await makeFee(admin, room.students[0], { title: `Cur ${uid()}`, amount: 1000, due_date: daysFromToday(10) });
    await makeFee(admin, room.students[0], { title: `Old ${uid()}`, amount: 400, due_date: daysFromToday(-10) });
    await call(admin, 'POST', `/api/fees/${current.id}/payments`, { amount: 250 });
    const after = (await call(admin, 'GET', '/api/fees/summary')).body;
    expect(round2(after.billed - before.billed)).toBe(1400);
    expect(round2(after.collected - before.collected)).toBe(250);
    expect(round2(after.outstanding - before.outstanding)).toBe(1150);
    expect(round2(after.overdue - before.overdue)).toBe(400);
  });
});

test.describe('access control', () => {
  test('teachers cannot see fees at all', async () => {
    const teacher = await makeUser(admin, 'teacher');
    for (const url of ['/api/fees', '/api/fees/summary']) {
      expect((await call(teacher.ctx, 'GET', url)).status).toBe(403);
    }
    expect(await call(teacher.ctx, 'GET', '/api/fees')).toMatchObject({ body: { error: 'Not allowed for your role' } });
  });

  test('students and parents cannot bill, pay offline or delete', async () => {
    const room = await makeClassroom(admin, { students: 1 });
    const parent = await makeParentOf(admin, room.students[0]);
    const fee = await makeFee(admin, room.students[0], { amount: 100 });
    for (const actor of [room.students[0], parent]) {
      expect((await call(actor.ctx, 'POST', '/api/fees', { student_id: room.students[0].studentId, title: 't', amount: 1, due_date: daysFromToday(1) })).status).toBe(403);
      expect((await call(actor.ctx, 'POST', `/api/fees/${fee.id}/payments`, { amount: 1 })).status).toBe(403);
      expect((await call(actor.ctx, 'DELETE', `/api/fees/${fee.id}`)).status).toBe(403);
      expect((await call(actor.ctx, 'GET', '/api/fees/summary')).status).toBe(403);
    }
  });

  test('parents see only linked children\'s fees', async () => {
    const room = await makeClassroom(admin, { students: 2 });
    const [mine, other] = room.students;
    const parent = await makeParentOf(admin, mine);
    await makeFee(admin, mine, { title: 'Mine', amount: 10 });
    await makeFee(admin, other, { title: 'Theirs', amount: 10 });
    expect((await call(parent.ctx, 'GET', `/api/fees?studentId=${mine.studentId}`)).body.map((f: { title: string }) => f.title)).toEqual(['Mine']);
    expect((await call(parent.ctx, 'GET', `/api/fees?studentId=${other.studentId}`)).status).toBe(403);
    expect((await call(parent.ctx, 'GET', '/api/fees')).status).toBe(400);
    // a student never sees a sibling's fees, whatever studentId they pass
    expect((await call(other.ctx, 'GET', `/api/fees?studentId=${mine.studentId}`)).body.map((f: { title: string }) => f.title)).toEqual(['Theirs']);
  });
});

test.describe('online payment (Stripe not configured in the test server)', () => {
  test('checkout returns a clear 501 for students and parents; other roles are 403', async () => {
    const room = await makeClassroom(admin, { students: 1 });
    const parent = await makeParentOf(admin, room.students[0]);
    const fee = await makeFee(admin, room.students[0], { amount: 100 });
    for (const actor of [room.students[0], parent]) {
      const res = await call(actor.ctx, 'POST', `/api/fees/${fee.id}/checkout`, { studentId: room.students[0].studentId });
      expect(res.status).toBe(501);
      expect(res.body.error).toMatch(/not configured/i);
    }
    expect((await call(admin, 'POST', `/api/fees/${fee.id}/checkout`, {})).status).toBe(403);
    expect((await call(room.teacher.ctx, 'POST', `/api/fees/${fee.id}/checkout`, {})).status).toBe(403);
  });
});

test.describe('Stripe webhook', () => {
  test('a correctly signed checkout.session.completed records one stripe payment (minor units -> major)', async () => {
    const room = await makeClassroom(admin, { students: 1 });
    const student = room.students[0];
    const title = `Web ${uid()}`;
    const fee = await makeFee(admin, student, { title, amount: 2500 });
    const body = checkoutCompletedEvent(fee.id, 100050, `cs_test_${uid()}`); // 1000.50
    const res = await postWebhook(admin, body, stripeSignature(body));
    expect(res).toMatchObject({ status: 200, body: { received: true } });

    const row = await findFee(admin, student, title);
    expect(round2(row.paid)).toBe(1000.5);
    expect(round2(row.balance)).toBe(1499.5);
    const payments = (await call(student.ctx, 'GET', '/api/fees')).body[0].payments;
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ method: 'stripe', amount: 1000.5 });
  });

  test('replaying the same event is idempotent', async () => {
    const room = await makeClassroom(admin, { students: 1 });
    const title = `Replay ${uid()}`;
    const fee = await makeFee(admin, room.students[0], { title, amount: 900 });
    const body = checkoutCompletedEvent(fee.id, 30000, `cs_test_${uid()}`);
    for (let i = 0; i < 3; i++) expect((await postWebhook(admin, body, stripeSignature(body))).status).toBe(200);
    expect(round2((await findFee(admin, room.students[0], title)).paid)).toBe(300);
  });

  test('bad signatures are rejected and record nothing', async () => {
    const room = await makeClassroom(admin, { students: 1 });
    const title = `Forged ${uid()}`;
    const fee = await makeFee(admin, room.students[0], { title, amount: 100 });
    const body = checkoutCompletedEvent(fee.id, 10000, `cs_test_${uid()}`);

    const attempts: Array<[string, string | undefined]> = [
      ['missing header', undefined],
      ['wrong secret', stripeSignature(body, { secret: 'whsec_wrong' })],
      ['tampered body', stripeSignature(body.replace('10000', '20000'))],
      ['stale timestamp', stripeSignature(body, { timestamp: Math.floor(Date.now() / 1000) - 3600 })],
      ['malformed header', 'garbage'],
    ];
    for (const [label, sig] of attempts) {
      const res = await postWebhook(admin, body, sig);
      expect(res.status, label).toBe(400);
      expect(res.body, label).toEqual({ error: 'Invalid signature' });
    }
    expect((await findFee(admin, room.students[0], title)).paid).toBe(0);
  });

  test('unpaid sessions, other event types and junk fee ids are acknowledged but ignored', async () => {
    const room = await makeClassroom(admin, { students: 1 });
    const title = `Ignored ${uid()}`;
    const fee = await makeFee(admin, room.students[0], { title, amount: 100 });
    const events = [
      checkoutCompletedEvent(fee.id, 10000, `cs_test_${uid()}`, 'unpaid'),
      JSON.stringify({ type: 'charge.refunded', data: { object: { id: 'x' } } }),
      checkoutCompletedEvent('not-a-number', 10000, `cs_test_${uid()}`),
    ];
    for (const body of events) {
      expect(await postWebhook(admin, body, stripeSignature(body))).toMatchObject({ status: 200, body: { received: true } });
    }
    expect((await findFee(admin, room.students[0], title)).paid).toBe(0);
  });
});
