import { APIRequestContext, expect, test } from '@playwright/test';
import { ADMIN, PASSWORD } from '../helpers/constants';
import { adminClient, anonClient, call, disposeAll, makeUser, newClient, signIn, TestUser } from '../helpers/client';
import { uniqueEmail } from '../helpers/data';

let admin: APIRequestContext;
let anon: APIRequestContext;

test.beforeAll(async () => {
  admin = await adminClient();
  anon = await anonClient();
});
test.afterAll(disposeAll);

test.describe('health and public surface', () => {
  test('GET /api/health reports pinned integration state', async () => {
    const res = await call(anon, 'GET', '/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, integrations: { stripe: false, email: false } });
  });

  test('public sign-up is blocked with the documented error', async () => {
    const res = await call(anon, 'POST', '/api/auth/sign-up/email', {
      name: 'Intruder',
      email: uniqueEmail('intruder'),
      password: 'Password123!',
      role: 'admin',
    });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Sign-up is disabled. Ask your school administrator.' });
  });

  test('a blocked sign-up does not create the account', async () => {
    const email = uniqueEmail('ghost');
    await call(anon, 'POST', '/api/auth/sign-up/email', { name: 'Ghost', email, password: 'Password123!' });
    const ctx = await newClient();
    const res = await ctx.post('/api/auth/sign-in/email', { data: { email, password: 'Password123!' } });
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });
});

test.describe('unauthenticated access is rejected', () => {
  const protectedRoutes: Array<[string, string]> = [
    ['GET', '/api/me'],
    ['GET', '/api/users'],
    ['GET', '/api/classes'],
    ['GET', '/api/subjects'],
    ['GET', '/api/class-subjects'],
    ['GET', '/api/students'],
    ['GET', '/api/attendance/student'],
    ['GET', '/api/grades/student'],
    ['GET', '/api/assignments'],
    ['GET', '/api/timetable'],
    ['GET', '/api/fees'],
    ['GET', '/api/fees/summary'],
    ['GET', '/api/announcements'],
    ['GET', '/api/dashboard'],
    ['POST', '/api/users'],
    ['POST', '/api/fees'],
    ['POST', '/api/announcements'],
  ];
  for (const [method, url] of protectedRoutes) {
    test(`${method} ${url} -> 401`, async () => {
      const res = await call(anon, method as 'GET' | 'POST', url, method === 'POST' ? {} : undefined);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Sign in required' });
    });
  }
});

test.describe('sign-in / sign-out', () => {
  test('admin signs in and /api/me reflects the admin role', async () => {
    const me = await call(admin, 'GET', '/api/me');
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ email: ADMIN.email, role: 'admin' });
    expect(me.body.students).toEqual([]);
  });

  test('wrong password is rejected and sets no session', async () => {
    const ctx = await newClient();
    const res = await ctx.post('/api/auth/sign-in/email', { data: { email: ADMIN.email, password: 'definitely-wrong' } });
    expect(res.status()).toBe(401);
    const me = await call(ctx, 'GET', '/api/me');
    expect(me.status).toBe(401);
  });

  test('unknown email is rejected', async () => {
    const ctx = await newClient();
    const res = await ctx.post('/api/auth/sign-in/email', { data: { email: uniqueEmail('nobody'), password: PASSWORD } });
    expect(res.status()).toBe(401);
  });

  test('sign-out ends the session', async () => {
    const user = await makeUser(admin, 'teacher');
    expect((await call(user.ctx, 'GET', '/api/me')).status).toBe(200);
    const out = await user.ctx.post('/api/auth/sign-out', { data: {} });
    expect(out.ok()).toBeTruthy();
    expect((await call(user.ctx, 'GET', '/api/me')).status).toBe(401);
  });

  test('a new account gets exactly the role the admin chose (case-insensitive email login)', async () => {
    const user = await makeUser(admin, 'parent');
    const ctx = await signIn(user.email.toUpperCase(), user.password);
    const me = await call(ctx, 'GET', '/api/me');
    expect(me.body.user.role).toBe('parent');
    expect(me.body.user.email).toBe(user.email);
  });
});

test.describe('password change', () => {
  test('user can change their own password; old one stops working', async () => {
    const user = await makeUser(admin, 'teacher');
    const next = 'NewPassw0rd!234';
    const res = await user.ctx.post('/api/auth/change-password', {
      data: { currentPassword: user.password, newPassword: next, revokeOtherSessions: true },
    });
    expect(res.ok(), await res.text()).toBeTruthy();

    const oldCtx = await newClient();
    const oldTry = await oldCtx.post('/api/auth/sign-in/email', { data: { email: user.email, password: user.password } });
    expect(oldTry.status()).toBe(401);
    const newCtx = await signIn(user.email, next);
    expect((await call(newCtx, 'GET', '/api/me')).status).toBe(200);
  });

  test('wrong current password is rejected', async () => {
    const user = await makeUser(admin, 'teacher');
    const res = await user.ctx.post('/api/auth/change-password', {
      data: { currentPassword: 'not-my-password', newPassword: 'Whatever123!' },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    await signIn(user.email, user.password); // still the original password
  });
});

test.describe('privilege escalation', () => {
  test('a user cannot set their own role through Better Auth update-user', async () => {
    const user = await makeUser(admin, 'student');
    await user.ctx.post('/api/auth/update-user', { data: { role: 'admin', active: true, name: 'Hacker' } });
    const me = await call(user.ctx, 'GET', '/api/me');
    expect(me.body.user.role).toBe('student');
    // and admin-only routes remain closed
    expect((await call(user.ctx, 'GET', '/api/users')).status).toBe(403);
  });
});

test.describe('deactivation', () => {
  let user: TestUser;
  test('deactivating revokes the live session and blocks future use', async () => {
    user = await makeUser(admin, 'teacher');
    expect((await call(user.ctx, 'GET', '/api/me')).status).toBe(200);

    const off = await call(admin, 'PATCH', `/api/users/${user.id}`, { active: false });
    expect(off.status).toBe(200);

    // existing session was deleted server-side
    expect((await call(user.ctx, 'GET', '/api/me')).status).toBe(401);

    // signing in still works at the auth layer, but the app refuses to serve the account
    const again = await signIn(user.email, user.password);
    const me = await call(again, 'GET', '/api/me');
    expect(me.status).toBe(403);
    expect(me.body).toEqual({ error: 'Account deactivated' });

    // reactivation restores access
    expect((await call(admin, 'PATCH', `/api/users/${user.id}`, { active: true })).status).toBe(200);
    const back = await signIn(user.email, user.password);
    expect((await call(back, 'GET', '/api/me')).status).toBe(200);
  });
});
