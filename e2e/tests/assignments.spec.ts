import { expect, test } from '@playwright/test';
import { addAssignment, adminApi, disposeApi, linkParent, makeClassroom, makeUser, Classroom, Person } from '../helpers/api';
import { daysFromToday, uid } from '../helpers/data';
import { Sessions } from '../helpers/session';
import { StudentAssignmentsPage, TeacherAssignmentsPage } from '../page-objects/assignments-page';

let room: Classroom;
let parent: Person;
let sessions: Sessions;

test.beforeAll(async () => {
  const admin = await adminApi();
  room = await makeClassroom(admin, { students: 2, studentNames: [`Sana Submit ${Date.now() % 100000}`, `Tej Tardy ${Date.now() % 100000}`] });
  parent = await makeUser(admin, 'parent');
  await linkParent(admin, parent, room.students[0]);
});
test.afterAll(disposeApi);
test.beforeEach(({ browser }) => {
  sessions = new Sessions(browser);
});
test.afterEach(async () => sessions.closeAll());

test('full lifecycle: post -> submit -> grade -> student sees marks and feedback', async () => {
  const [sana, tej] = room.students;
  const title = `Essay ${uid()}`;

  // teacher posts through the UI
  const { page: tp } = await sessions.open(room.teacher);
  const teacher = new TeacherAssignmentsPage(tp);
  await teacher.goto();
  await teacher.post({ subjectLabel: room.subjectName, title, maxMarks: 20, dueDate: daysFromToday(10), instructions: 'Write 200 words on rivers' });
  await expect(teacher.posted()).toBeVisible();
  await expect(teacher.row(title)).toContainText(room.className);

  // student sees it as pending and submits
  const { page: sp } = await sessions.open(sana);
  const student = new StudentAssignmentsPage(sp);
  await student.goto();
  await expect(student.item(title)).toContainText('Write 200 words on rivers');
  await expect(student.item(title)).toContainText('pending');
  await student.submit(title, 'Rivers carry water to the sea.');
  await expect(student.submitted()).toBeVisible();
  await expect(student.item(title)).toContainText('submitted');

  // teacher sees one submission and grades it
  await teacher.goto();
  await expect(teacher.row(title).getByRole('cell').nth(4)).toHaveText('1');
  await teacher.openSubmissions(title);
  await expect(teacher.submission(sana.name)).toContainText('Rivers carry water to the sea.');
  await expect(teacher.submission(sana.name)).toContainText('needs grading');
  await expect(teacher.submission(tej.name)).toContainText('not submitted');
  await teacher.grade(sana.name, 17, 'Clear and concise');
  await expect(teacher.graded()).toBeVisible();

  // student now sees the mark and feedback, and can no longer edit
  await student.goto();
  await expect(student.item(title)).toContainText('17 / 20');
  await expect(student.item(title)).toContainText('Teacher feedback: Clear and concise');
  await expect(student.item(title).getByRole('textbox')).toHaveCount(0);
  await expect(student.item(title).getByRole('button', { name: /submit/i })).toHaveCount(0);

  // the parent sees the same result read-only
  const { page: pp } = await sessions.open(parent);
  const asParent = new StudentAssignmentsPage(pp);
  await asParent.goto();
  await expect(asParent.item(title)).toContainText('17 / 20');
  await expect(asParent.item(title).getByRole('textbox')).toHaveCount(0);
});

test('a student can revise their answer until it is graded', async () => {
  const [, tej] = room.students;
  const title = `Revisable ${uid()}`;
  await addAssignment(room.teacher, room.csId, title);
  const { page } = await sessions.open(tej);
  const student = new StudentAssignmentsPage(page);
  await student.goto();
  await student.submit(title, 'first draft');
  await expect(student.submitted()).toBeVisible();
  await page.reload();
  await expect(student.item(title).getByLabel(`Your answer for ${title}`)).toHaveValue('first draft');
  await student.submit(title, 'second draft');
  await page.reload();
  await expect(student.item(title).getByLabel(`Your answer for ${title}`)).toHaveValue('second draft');
  await expect(student.item(title).getByRole('button', { name: 'Resubmit' })).toBeVisible();
});

test('submit is disabled for an empty answer', async () => {
  const title = `Blank ${uid()}`;
  await addAssignment(room.teacher, room.csId, title);
  const { page } = await sessions.open(room.students[0]);
  const student = new StudentAssignmentsPage(page);
  await student.goto();
  await expect(student.item(title).getByRole('button', { name: 'Submit' })).toBeDisabled();
  await student.item(title).getByLabel(`Your answer for ${title}`).fill('something');
  await expect(student.item(title).getByRole('button', { name: 'Submit' })).toBeEnabled();
});

test('grading above the maximum shows the server error', async () => {
  const [sana] = room.students;
  const title = `Strict ${uid()}`;
  const id = await addAssignment(room.teacher, room.csId, title, 10);
  expect(id).toBeGreaterThan(0);
  const { page: sp } = await sessions.open(sana);
  await new StudentAssignmentsPage(sp).goto();
  await new StudentAssignmentsPage(sp).submit(title, 'answer');
  await expect(new StudentAssignmentsPage(sp).submitted()).toBeVisible();

  const { page: tp } = await sessions.open(room.teacher);
  const teacher = new TeacherAssignmentsPage(tp);
  await teacher.goto();
  await teacher.openSubmissions(title);
  await teacher.grade(sana.name, 11);
  await expect(tp.getByRole('alert')).toContainText('Marks must be between 0 and 10');
  await teacher.grade(sana.name, 10);
  await expect(teacher.graded()).toBeVisible();
});

test("students never see another class's assignments", async () => {
  const admin = await adminApi();
  const other = await makeClassroom(admin, { students: 1 });
  const title = `Elsewhere ${uid()}`;
  await addAssignment(other.teacher, other.csId, title);
  const { page } = await sessions.open(room.students[0]);
  await new StudentAssignmentsPage(page).goto();
  await expect(page.getByRole('heading', { level: 2, name: title })).toHaveCount(0);
});

test('a colleague who teaches a different subject cannot see or grade this subject\'s work', async () => {
  const admin = await adminApi();
  const colleague = await makeUser(admin, 'teacher');
  const title = `Private ${uid()}`;
  await addAssignment(room.teacher, room.csId, title);
  const { page } = await sessions.open(colleague);
  const teacher = new TeacherAssignmentsPage(page);
  await teacher.goto();
  await expect(teacher.row(title)).toHaveCount(0);
});
