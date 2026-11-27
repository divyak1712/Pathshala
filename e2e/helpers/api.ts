import { APIRequestContext, expect, request } from '@playwright/test';
import { ADMIN, BASE_URL, PASSWORD } from './constants';
import { uid, uniqueEmail } from './data';

/**
 * Fast test-data provisioning through the real HTTP API. The UI under test is then driven only for the
 * behaviour a spec is actually about (never for incidental setup like creating a class).
 */
const opened: APIRequestContext[] = [];

async function login(email: string, password: string): Promise<APIRequestContext> {
  const ctx = await request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { Origin: BASE_URL } });
  opened.push(ctx);
  const res = await ctx.post('/api/auth/sign-in/email', { data: { email, password } });
  expect(res.ok(), `API sign-in failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return ctx;
}
export const adminApi = () => login(ADMIN.email, ADMIN.password);
export const disposeApi = async () => Promise.all(opened.splice(0).map((c) => c.dispose().catch(() => undefined)));

async function json(ctx: APIRequestContext, method: 'get' | 'post' | 'put' | 'patch', url: string, data?: unknown) {
  const res = await ctx[method](url, { data: data as object | undefined });
  const body = await res.json().catch(() => null);
  return { status: res.status(), body };
}

export interface Person {
  id: string;
  name: string;
  email: string;
  password: string;
  role: string;
  studentId?: number;
}
type Role = 'admin' | 'teacher' | 'student' | 'parent';

export async function makeUser(admin: APIRequestContext, role: Role, opts: { name?: string; student?: Record<string, unknown> } = {}): Promise<Person> {
  const email = uniqueEmail(role);
  const name = opts.name ?? `E2E ${role} ${uid()}`;
  const body: Record<string, unknown> = { name, email, password: PASSWORD, role };
  if (role === 'student') body.student = { admission_no: `ADM-${uid()}`, ...opts.student };
  const res = await json(admin, 'post', '/api/users', body);
  expect(res.status, `create ${role}: ${JSON.stringify(res.body)}`).toBe(201);
  const person: Person = { id: res.body.id, name, email, password: PASSWORD, role };
  if (role === 'student') {
    const ctx = await login(email, PASSWORD);
    person.studentId = (await json(ctx, 'get', '/api/me')).body.students[0].id;
  }
  return person;
}

export interface Classroom {
  classId: number;
  className: string; // e.g. "C-abc 123"; displayed as `${className} A`
  subjectName: string;
  csId: number;
  teacher: Person;
  students: Person[];
}

export async function makeClassroom(admin: APIRequestContext, opts: { students?: number; studentNames?: string[] } = {}): Promise<Classroom> {
  const teacher = await makeUser(admin, 'teacher');
  const className = `Class ${uid()}`;
  const cls = await json(admin, 'post', '/api/classes', { name: className, section: 'A', academic_year: '2099-00', class_teacher_id: teacher.id });
  expect(cls.status, JSON.stringify(cls.body)).toBe(201);
  const subjectName = `Subject ${uid()}`;
  const subject = await json(admin, 'post', '/api/subjects', { name: subjectName, code: `S${uid()}` });
  const cs = await json(admin, 'put', '/api/class-subjects', { class_id: cls.body.id, subject_id: subject.body.id, teacher_id: teacher.id });
  expect(cs.status, JSON.stringify(cs.body)).toBe(200);

  const n = opts.students ?? 1;
  const students: Person[] = [];
  for (let i = 0; i < n; i++) {
    students.push(await makeUser(admin, 'student', { name: opts.studentNames?.[i], student: { class_id: cls.body.id, roll_no: i + 1 } }));
  }
  return { classId: cls.body.id, className, subjectName, csId: cs.body.id, teacher, students };
}

export async function linkParent(admin: APIRequestContext, parent: Person, ...children: Person[]) {
  for (const child of children) {
    const res = await json(admin, 'put', `/api/users/students/${child.studentId}/parents`, { parentIds: [parent.id] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }
}

export async function addFee(admin: APIRequestContext, student: Person, title: string, amount: number, dueInDays = 30) {
  const due = new Date();
  due.setUTCDate(due.getUTCDate() + dueInDays);
  const res = await json(admin, 'post', '/api/fees', { student_id: student.studentId, title, amount, due_date: due.toISOString().slice(0, 10) });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
}

export async function addAssignment(teacher: Person, csId: number, title: string, maxMarks = 20) {
  const ctx = await login(teacher.email, teacher.password);
  const due = new Date();
  due.setUTCDate(due.getUTCDate() + 14);
  const res = await json(ctx, 'post', '/api/assignments', { class_subject_id: csId, title, description: 'Read chapter 4', due_date: due.toISOString().slice(0, 10), max_marks: maxMarks });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as number;
}
