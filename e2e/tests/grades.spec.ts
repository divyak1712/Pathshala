import { expect, test } from '@playwright/test';
import { adminApi, disposeApi, linkParent, makeClassroom, makeUser, Classroom, Person } from '../helpers/api';
import { uid } from '../helpers/data';
import { Sessions } from '../helpers/session';
import { GradebookPage, ReportCardPage } from '../page-objects/grades-page';

let room: Classroom;
let parent: Person;
let sessions: Sessions;

test.beforeAll(async () => {
  const admin = await adminApi();
  room = await makeClassroom(admin, { students: 2, studentNames: [`Grace Grade ${Date.now() % 100000}`, `Hari Higher ${Date.now() % 100000}`] });
  parent = await makeUser(admin, 'parent');
  await linkParent(admin, parent, room.students[0]);
});
test.afterAll(disposeApi);
test.beforeEach(({ browser }) => {
  sessions = new Sessions(browser);
});
test.afterEach(async () => sessions.closeAll());

test('teacher creates an assessment and grades it; student and parent see the report card', async () => {
  const [grace, hari] = room.students;
  const title = `Midterm ${uid()}`;
  const { page: tp } = await sessions.open(room.teacher);
  const gradebook = new GradebookPage(tp);
  await gradebook.goto();
  await gradebook.selectSubject(room.subjectName);

  await gradebook.createAssessment({ title, type: 'exam', maxMarks: 50 });
  await expect(gradebook.assessmentRow(title)).toContainText('exam');
  await expect(gradebook.assessmentRow(title)).toContainText('50');

  await gradebook.openMarks(title);
  await gradebook.enterMarks(grace.name, 40, 'Excellent work');
  await gradebook.enterMarks(hari.name, 25);
  await gradebook.saveMarks();
  await expect(gradebook.saved()).toBeVisible();
  await expect(gradebook.assessmentRow(title).getByRole('cell').nth(4)).toHaveText('2'); // graded count

  // student: 40/50 = 80%
  const { page: sp } = await sessions.open(grace);
  const card = new ReportCardPage(sp);
  await card.goto();
  await expect(card.subjectRow(room.subjectName)).toContainText('80%');
  await expect(card.resultRow(title)).toContainText('40 / 50');
  await expect(card.resultRow(title)).toContainText('Excellent work');

  // another student sees only their own score
  const { page: hp } = await sessions.open(hari);
  await new ReportCardPage(hp).goto();
  await expect(new ReportCardPage(hp).resultRow(title)).toContainText('25 / 50');
  await expect(new ReportCardPage(hp).subjectRow(room.subjectName)).toContainText('50%');

  // parent of Grace sees Grace's card
  const { page: pp } = await sessions.open(parent);
  await new ReportCardPage(pp).goto();
  await expect(new ReportCardPage(pp).resultRow(title)).toContainText('40 / 50');
});

test('marks above the maximum are rejected by the server and shown to the teacher', async () => {
  const title = `Strict ${uid()}`;
  const { page } = await sessions.open(room.teacher);
  const gradebook = new GradebookPage(page);
  await gradebook.goto();
  await gradebook.selectSubject(room.subjectName);
  await gradebook.createAssessment({ title, maxMarks: 20 });
  await gradebook.openMarks(title);
  await gradebook.enterMarks(room.students[0].name, 21);
  await gradebook.saveMarks();
  await expect(gradebook.error()).toContainText('Marks must be between 0 and 20');
  await expect(gradebook.saved()).toHaveCount(0);

  await gradebook.enterMarks(room.students[0].name, 20);
  await gradebook.saveMarks();
  await expect(gradebook.saved()).toBeVisible();
});

test('clearing a mark removes it from the report card', async () => {
  const [grace] = room.students;
  const title = `Clearable ${uid()}`;
  const { page } = await sessions.open(room.teacher);
  const gradebook = new GradebookPage(page);
  await gradebook.goto();
  await gradebook.selectSubject(room.subjectName);
  await gradebook.createAssessment({ title, maxMarks: 10 });
  await gradebook.openMarks(title);
  await gradebook.enterMarks(grace.name, 9);
  await gradebook.saveMarks();
  await expect(gradebook.saved()).toBeVisible();
  await gradebook.enterMarks(grace.name, '');
  await gradebook.saveMarks();
  await expect(gradebook.assessmentRow(title).getByRole('cell').nth(4)).toHaveText('0');

  const { page: sp } = await sessions.open(grace);
  await new ReportCardPage(sp).goto();
  await expect(new ReportCardPage(sp).resultRow(title)).toHaveCount(0);
});

test('deleting an assessment asks for confirmation', async () => {
  const title = `Doomed ${uid()}`;
  const { page } = await sessions.open(room.teacher);
  const gradebook = new GradebookPage(page);
  await gradebook.goto();
  await gradebook.selectSubject(room.subjectName);
  await gradebook.createAssessment({ title, maxMarks: 10 });
  await expect(gradebook.assessmentRow(title)).toBeVisible();

  page.once('dialog', (d) => d.dismiss());
  await gradebook.assessmentRow(title).getByRole('button', { name: 'Delete' }).click();
  await expect(gradebook.assessmentRow(title)).toBeVisible();

  page.once('dialog', (d) => d.accept());
  await gradebook.assessmentRow(title).getByRole('button', { name: 'Delete' }).click();
  await expect(gradebook.assessmentRow(title)).toHaveCount(0);
});

test('a teacher with no subjects sees guidance instead of an empty broken form', async () => {
  const admin = await adminApi();
  const idle = await makeUser(admin, 'teacher');
  const { page } = await sessions.open(idle);
  await new GradebookPage(page).goto();
  await expect(page.getByText(/do not teach any subjects yet/i)).toBeVisible();
});

test('a student with no results sees an empty state', async () => {
  const admin = await adminApi();
  const fresh = await makeClassroom(admin, { students: 1 });
  const { page } = await sessions.open(fresh.students[0]);
  await new ReportCardPage(page).goto();
  await expect(page.getByText('No grades published yet.')).toBeVisible();
});
