import { APIRequestContext, expect, test } from '@playwright/test';
import { PASSWORD } from '../helpers/constants';
import { adminClient, call, disposeAll, makeClassroom, makeUser, newClient, signIn } from '../helpers/client';
import { uid, uniqueEmail } from '../helpers/data';

let admin: APIRequestContext;
test.beforeAll(async () => {
  admin = await adminClient();
});
test.afterAll(disposeAll);

test.describe('create', () => {
  for (const role of ['admin', 'teacher', 'parent'] as const) {
    test(`admin creates a ${role}; response omits secrets and email is normalised`, async () => {
      const email = uniqueEmail(role).toUpperCase();
      const res = await call(admin, 'POST', '/api/users', { name: `  Pat ${role} `, email, password: PASSWORD, role });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: expect.any(String), name: `Pat ${role}`, email: email.toLowerCase(), role });
      const ctx = await signIn(email.toLowerCase(), PASSWORD);
      expect((await call(ctx, 'GET', '/api/me')).body.user.role).toBe(role);
    });
  }

  test('student gets a profile with class, roll and admission number', async () => {
    const room = await makeClassroom(admin, { students: 0 });
    const student = await makeUser(admin, 'student', { student: { class_id: room.classId, roll_no: 7, admission_no: `ADM-${uid()}` } });
    const roster = await call(admin, 'GET', `/api/students?classId=${room.classId}`);
    expect(roster.body).toHaveLength(1);
    expect(roster.body[0]).toMatchObject({ id: student.studentId, class_id: room.classId, roll_no: 7, name: student.name });
    expect(roster.body[0].parents).toEqual([]);
  });

  test('validation errors', async () => {
    const base = { name: 'X', email: uniqueEmail('v'), password: PASSWORD, role: 'teacher' };
    const cases: Array<[string, Record<string, unknown>, number, string]> = [
      ['missing name', { ...base, name: '' }, 400, 'Name is required'],
      ['missing email', { ...base, email: undefined }, 400, 'Email is required'],
      ['missing password', { ...base, password: '' }, 400, 'Password is required'],
      ['invalid role', { ...base, role: 'superuser' }, 400, 'Invalid role'],
      ['short password', { ...base, password: 'short' }, 400, 'Password must be at least 8 characters'],
      ['student without admission no', { ...base, role: 'student' }, 400, 'Admission number is required for students'],
    ];
    for (const [label, body, status, error] of cases) {
      const res = await call(admin, 'POST', '/api/users', body);
      expect(res.status, label).toBe(status);
      expect(res.body, label).toEqual({ error });
    }
  });

  test('duplicate email is rejected', async () => {
    const first = await makeUser(admin, 'teacher');
    const res = await call(admin, 'POST', '/api/users', { name: 'Dup', email: first.email, password: PASSWORD, role: 'teacher' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  test('duplicate admission number -> 409 and the half-created account is rolled back', async () => {
    const admission = `ADM-${uid()}`;
    await makeUser(admin, 'student', { student: { admission_no: admission } });
    const email = uniqueEmail('rollback');
    const res = await call(admin, 'POST', '/api/users', {
      name: 'Rolled Back',
      email,
      password: PASSWORD,
      role: 'student',
      student: { admission_no: admission },
    });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'That record already exists' });

    // account must not exist: cannot sign in, and the email can be reused
    const ctx = await newClient();
    expect((await ctx.post('/api/auth/sign-in/email', { data: { email, password: PASSWORD } })).status()).toBe(401);
    const retry = await call(admin, 'POST', '/api/users', {
      name: 'Rolled Back',
      email,
      password: PASSWORD,
      role: 'student',
      student: { admission_no: `ADM-${uid()}` },
    });
    expect(retry.status).toBe(201);
  });
});

test.describe('list, update, delete', () => {
  test('list can be filtered by role and exposes no password material', async () => {
    const teacher = await makeUser(admin, 'teacher');
    const res = await call(admin, 'GET', '/api/users?role=teacher');
    expect(res.status).toBe(200);
    expect(res.body.every((u: { role: string }) => u.role === 'teacher')).toBe(true);
    const row = res.body.find((u: { id: string }) => u.id === teacher.id);
    expect(row).toMatchObject({ name: teacher.name, email: teacher.email, active: true });
    expect(JSON.stringify(res.body)).not.toMatch(/password|accessToken|refreshToken/i);
  });

  test('an unknown role filter is ignored rather than erroring', async () => {
    const res = await call(admin, 'GET', '/api/users?role=nonsense');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('rename, change role, reset password', async () => {
    const user = await makeUser(admin, 'teacher');
    const rename = await call(admin, 'PATCH', `/api/users/${user.id}`, { name: 'Renamed Person', role: 'parent' });
    expect(rename.status).toBe(200);
    const me = await call(await signIn(user.email, user.password), 'GET', '/api/me');
    expect(me.body.user).toMatchObject({ name: 'Renamed Person', role: 'parent' });

    const reset = await call(admin, 'PATCH', `/api/users/${user.id}`, { password: 'ResetPassw0rd!' });
    expect(reset.status).toBe(200);
    expect((await call(user.ctx, 'GET', '/api/me')).status).toBe(401); // sessions revoked on reset
    expect((await (await newClient()).post('/api/auth/sign-in/email', { data: { email: user.email, password: user.password } })).status()).toBe(401);
    expect((await call(await signIn(user.email, 'ResetPassw0rd!'), 'GET', '/api/me')).status).toBe(200);
  });

  test('update validation', async () => {
    const user = await makeUser(admin, 'teacher');
    expect(await call(admin, 'PATCH', `/api/users/${user.id}`, { role: 'wizard' })).toMatchObject({ status: 400, body: { error: 'Invalid role' } });
    expect(await call(admin, 'PATCH', `/api/users/${user.id}`, { password: 'short' })).toMatchObject({
      status: 400,
      body: { error: 'Password must be at least 8 characters' },
    });
    expect(await call(admin, 'PATCH', '/api/users/does-not-exist', { name: 'x' })).toMatchObject({ status: 404, body: { error: 'User not found' } });
  });

  test('admin cannot demote, deactivate or delete themselves', async () => {
    const me = (await call(admin, 'GET', '/api/me')).body.user.id;
    expect(await call(admin, 'PATCH', `/api/users/${me}`, { role: 'teacher' })).toMatchObject({
      status: 400,
      body: { error: 'You cannot change your own role' },
    });
    expect(await call(admin, 'PATCH', `/api/users/${me}`, { active: false })).toMatchObject({
      status: 400,
      body: { error: 'You cannot deactivate yourself' },
    });
    expect(await call(admin, 'DELETE', `/api/users/${me}`)).toMatchObject({ status: 400, body: { error: 'You cannot delete yourself' } });
    expect((await call(admin, 'GET', '/api/me')).status).toBe(200);
  });

  test('delete removes the account; unknown id is 404', async () => {
    const user = await makeUser(admin, 'teacher');
    expect(await call(admin, 'DELETE', `/api/users/${user.id}`)).toMatchObject({ status: 200, body: { ok: true } });
    expect((await call(user.ctx, 'GET', '/api/me')).status).toBe(401);
    expect(await call(admin, 'DELETE', `/api/users/${user.id}`)).toMatchObject({ status: 404, body: { error: 'User not found' } });
  });

  test('deleting a student cascades to the roster', async () => {
    const room = await makeClassroom(admin, { students: 2 });
    await call(admin, 'DELETE', `/api/users/${room.students[0].id}`);
    const roster = await call(admin, 'GET', `/api/students?classId=${room.classId}`);
    expect(roster.body.map((s: { id: number }) => s.id)).toEqual([room.students[1].studentId]);
  });
});

test.describe('parent linking', () => {
  test('link, replace and clear parents', async () => {
    const room = await makeClassroom(admin, { students: 1 });
    const child = room.students[0];
    const p1 = await makeUser(admin, 'parent');
    const p2 = await makeUser(admin, 'parent');

    expect((await call(admin, 'PUT', `/api/users/students/${child.studentId}/parents`, { parentIds: [p1.id, p2.id] })).status).toBe(200);
    expect((await call(p1.ctx, 'GET', '/api/me')).body.students.map((s: { id: number }) => s.id)).toEqual([child.studentId]);
    expect((await call(p2.ctx, 'GET', '/api/me')).body.students).toHaveLength(1);

    await call(admin, 'PUT', `/api/users/students/${child.studentId}/parents`, { parentIds: [p2.id] });
    expect((await call(p1.ctx, 'GET', '/api/me')).body.students).toEqual([]);
    expect((await call(p2.ctx, 'GET', '/api/me')).body.students).toHaveLength(1);

    await call(admin, 'PUT', `/api/users/students/${child.studentId}/parents`, { parentIds: [] });
    expect((await call(p2.ctx, 'GET', '/api/me')).body.students).toEqual([]);
  });

  test('linking a non-parent is rejected and the previous links survive (transaction rollback)', async () => {
    const room = await makeClassroom(admin, { students: 1 });
    const child = room.students[0];
    const parent = await makeUser(admin, 'parent');
    await call(admin, 'PUT', `/api/users/students/${child.studentId}/parents`, { parentIds: [parent.id] });

    const bad = await call(admin, 'PUT', `/api/users/students/${child.studentId}/parents`, { parentIds: [parent.id, room.teacher.id] });
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ error: 'Linked user is not a parent' });
    expect((await call(parent.ctx, 'GET', '/api/me')).body.students).toHaveLength(1);
  });
});

test.describe('access control: only admins manage users', () => {
  for (const role of ['teacher', 'student', 'parent'] as const) {
    test(`${role} gets 403 on every user-management endpoint`, async () => {
      const actor = await makeUser(admin, role);
      const target = await makeUser(admin, 'teacher');
      const attempts: Array<[Parameters<typeof call>[1], string, unknown?]> = [
        ['GET', '/api/users'],
        ['POST', '/api/users', { name: 'n', email: uniqueEmail('x'), password: PASSWORD, role: 'admin' }],
        ['PATCH', `/api/users/${target.id}`, { role: 'admin' }],
        ['DELETE', `/api/users/${target.id}`],
        ['PUT', '/api/users/students/1/parents', { parentIds: [] }],
      ];
      for (const [method, url, body] of attempts) {
        const res = await call(actor.ctx, method, url, body);
        expect(res.status, `${role} ${method} ${url}`).toBe(403);
        expect(res.body).toEqual({ error: 'Not allowed for your role' });
      }
      // target untouched
      expect((await call(admin, 'GET', '/api/users?role=teacher')).body.some((u: { id: string }) => u.id === target.id)).toBe(true);
    });
  }
});
