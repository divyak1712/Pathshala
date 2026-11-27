import { APIRequestContext, expect, request } from '@playwright/test';
import crypto from 'node:crypto';
import { ADMIN, BASE_URL, PASSWORD, WEBHOOK_SECRET } from './constants';
import { uid, uniqueEmail } from './data';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export interface Result {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  headers: Record<string, string>;
}

const opened: APIRequestContext[] = [];

/** A cookie-jar context: one context == one signed-in (or anonymous) user. Origin is sent because Better Auth checks it. */
export async function newClient(): Promise<APIRequestContext> {
  const ctx = await request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { Origin: BASE_URL } });
  opened.push(ctx);
  return ctx;
}
export async function disposeAll(): Promise<void> {
  await Promise.all(opened.splice(0).map((c) => c.dispose().catch(() => undefined)));
}

export async function call(ctx: APIRequestContext, method: Method, url: string, data?: unknown): Promise<Result> {
  const res = await ctx.fetch(url, { method, data: data as object | undefined });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body stays as text */
  }
  return { status: res.status(), body, headers: res.headers() };
}

export async function signIn(email: string, password: string): Promise<APIRequestContext> {
  const ctx = await newClient();
  const res = await ctx.post('/api/auth/sign-in/email', { data: { email, password } });
  expect(res.ok(), `sign-in failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return ctx;
}
export const adminClient = () => signIn(ADMIN.email, ADMIN.password);
export const anonClient = () => newClient();

export interface TestUser {
  id: string;
  name: string;
  email: string;
  password: string;
  role: string;
  ctx: APIRequestContext;
  studentId?: number;
}

type Role = 'admin' | 'teacher' | 'student' | 'parent';

/** Admin provisions an account through the public API, then we sign in as it. */
export async function makeUser(
  admin: APIRequestContext,
  role: Role,
  extra: { student?: Record<string, unknown>; name?: string } = {},
): Promise<TestUser> {
  const email = uniqueEmail(role);
  const name = extra.name ?? `API ${role} ${uid()}`;
  const body: Record<string, unknown> = { name, email, password: PASSWORD, role };
  if (role === 'student') body.student = { admission_no: `ADM-${uid()}`, ...extra.student };
  const res = await call(admin, 'POST', '/api/users', body);
  expect(res.status, `create ${role}: ${JSON.stringify(res.body)}`).toBe(201);
  const ctx = await signIn(email, PASSWORD);
  const user: TestUser = { id: res.body.id, name, email, password: PASSWORD, role, ctx };
  if (role === 'student') {
    const me = await call(ctx, 'GET', '/api/me');
    user.studentId = me.body.students[0].id;
  }
  return user;
}

export interface Classroom {
  classId: number;
  className: string;
  subjectId: number;
  subjectName: string;
  csId: number; // class_subjects id: the teaching unit
  teacher: TestUser;
  students: TestUser[];
}

/** A fresh class + subject + teacher (assigned as both class teacher and subject teacher) + N students. */
export async function makeClassroom(admin: APIRequestContext, opts: { students?: number } = {}): Promise<Classroom> {
  const teacher = await makeUser(admin, 'teacher');
  const className = `C-${uid()}`;
  const cls = await call(admin, 'POST', '/api/classes', {
    name: className,
    section: 'A',
    academic_year: '2099-00',
    class_teacher_id: teacher.id,
  });
  expect(cls.status, JSON.stringify(cls.body)).toBe(201);
  const subjectName = `Subject ${uid()}`;
  const subject = await call(admin, 'POST', '/api/subjects', { name: subjectName, code: `S${uid()}` });
  expect(subject.status, JSON.stringify(subject.body)).toBe(201);
  const cs = await call(admin, 'PUT', '/api/class-subjects', {
    class_id: cls.body.id,
    subject_id: subject.body.id,
    teacher_id: teacher.id,
  });
  expect(cs.status, JSON.stringify(cs.body)).toBe(200);

  const students: TestUser[] = [];
  for (let i = 0; i < (opts.students ?? 1); i++) {
    students.push(await makeUser(admin, 'student', { student: { class_id: cls.body.id, roll_no: i + 1 } }));
  }
  return { classId: cls.body.id, className, subjectId: subject.body.id, subjectName, csId: cs.body.id, teacher, students };
}

/** Links a parent to a student and returns the parent. */
export async function makeParentOf(admin: APIRequestContext, ...students: TestUser[]): Promise<TestUser> {
  const parent = await makeUser(admin, 'parent');
  // Links are per student, replacing the set: merge with any existing parents is not needed for fresh students.
  for (const s of students) {
    const res = await call(admin, 'PUT', `/api/users/students/${s.studentId}/parents`, { parentIds: [parent.id] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }
  return parent;
}

/** Creates a fee for one student and returns its ledger row (as seen by admin). */
export async function makeFee(
  admin: APIRequestContext,
  student: TestUser,
  opts: { title?: string; amount?: number; due_date?: string } = {},
) {
  const title = opts.title ?? `Fee ${uid()}`;
  const res = await call(admin, 'POST', '/api/fees', {
    student_id: student.studentId,
    title,
    amount: opts.amount ?? 1000,
    due_date: opts.due_date ?? '2099-01-01',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return findFee(admin, student, title);
}

export async function findFee(admin: APIRequestContext, student: TestUser, title: string) {
  const ledger = await call(admin, 'GET', '/api/fees');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fee = ledger.body.find((f: any) => f.student_id === student.studentId && f.title === title);
  expect(fee, `fee "${title}" not found in ledger`).toBeTruthy();
  return fee as { id: number; amount: number; paid: number; balance: number; status: string };
}

/** Builds a valid Stripe-Signature header for the webhook route. */
export function stripeSignature(rawBody: string, opts: { secret?: string; timestamp?: number } = {}): string {
  const t = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac('sha256', opts.secret ?? WEBHOOK_SECRET).update(`${t}.${rawBody}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

/** Posts a raw (already-serialised) webhook body. */
export async function postWebhook(ctx: APIRequestContext, rawBody: string, signature?: string): Promise<Result> {
  const res = await ctx.post('/api/webhooks/stripe', {
    data: rawBody,
    headers: { 'Content-Type': 'application/json', ...(signature ? { 'Stripe-Signature': signature } : {}) },
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: res.status(), body, headers: res.headers() };
}

export function checkoutCompletedEvent(feeId: number | string, amountInMinorUnits: number, sessionId: string, paymentStatus = 'paid') {
  return JSON.stringify({
    type: 'checkout.session.completed',
    data: { object: { id: sessionId, payment_status: paymentStatus, amount_total: amountInMinorUnits, metadata: { fee_id: String(feeId) } } },
  });
}
