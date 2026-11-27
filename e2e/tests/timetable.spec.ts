import { expect, test } from '@playwright/test';
import { adminApi, disposeApi, linkParent, makeClassroom, makeUser, Classroom, Person } from '../helpers/api';
import { ADMIN } from '../helpers/constants';
import { Sessions } from '../helpers/session';
import { TimetablePage } from '../page-objects/timetable-page';

const adminUser = { email: ADMIN.email, password: ADMIN.password, name: ADMIN.name };
let room: Classroom;
let parent: Person;
let sessions: Sessions;

test.beforeAll(async () => {
  const admin = await adminApi();
  room = await makeClassroom(admin, { students: 1 });
  parent = await makeUser(admin, 'parent');
  await linkParent(admin, parent, room.students[0]);
});
test.afterAll(disposeApi);
test.beforeEach(({ browser }) => {
  sessions = new Sessions(browser);
});
test.afterEach(async () => sessions.closeAll());

test('admin schedules a period; students, parents and the teacher each see it', async () => {
  const { page: ap } = await sessions.open(adminUser);
  const tt = new TimetablePage(ap);
  await tt.goto();
  await tt.chooseClass(`${room.className} A`);
  await tt.addPeriod({ subjectLabel: room.subjectName, day: 'Wednesday', start: '09:00', end: '09:45', room: 'Lab 2' });
  await expect(tt.added()).toBeVisible();
  const row = tt.period('Wednesday', '09:00');
  await expect(row).toContainText(room.subjectName);
  await expect(row).toContainText(room.teacher.name);
  await expect(row).toContainText('Lab 2');

  const { page: sp } = await sessions.open(room.students[0]);
  const student = new TimetablePage(sp);
  await student.goto();
  await expect(student.period('Wednesday', '09:00')).toContainText(room.subjectName);
  await expect(sp.getByRole('columnheader', { name: 'Class' })).toHaveCount(0); // students don't need the class column

  const { page: pp } = await sessions.open(parent);
  await new TimetablePage(pp).goto();
  await expect(new TimetablePage(pp).period('Wednesday', '09:00')).toContainText(room.subjectName);

  const { page: tp } = await sessions.open(room.teacher);
  await new TimetablePage(tp).goto();
  await expect(tp.getByRole('heading', { level: 1, name: 'My timetable' })).toBeVisible();
  await expect(new TimetablePage(tp).period('Wednesday', '09:00')).toContainText(`${room.className} A`);
});

test('overlapping periods and invalid times are rejected with a clear message', async () => {
  const admin = await adminApi();
  const solo = await makeClassroom(admin, { students: 0 });
  const { page } = await sessions.open(adminUser);
  const tt = new TimetablePage(page);
  await tt.goto();
  await tt.chooseClass(`${solo.className} A`);

  await tt.addPeriod({ subjectLabel: solo.subjectName, day: 'Monday', start: '10:00', end: '10:45' });
  await expect(tt.added()).toBeVisible();

  await tt.addPeriod({ subjectLabel: solo.subjectName, day: 'Monday', start: '10:30', end: '11:15' });
  await expect(tt.error()).toContainText('Clashes with an existing period for this class or teacher');

  await tt.addPeriod({ subjectLabel: solo.subjectName, day: 'Monday', start: '12:00', end: '11:00' });
  await expect(tt.error()).toContainText('End time must be after start time');

  // back-to-back is allowed
  await tt.addPeriod({ subjectLabel: solo.subjectName, day: 'Monday', start: '10:45', end: '11:30' });
  await expect(tt.added()).toBeVisible();
  await expect(tt.period('Monday', '10:45')).toBeVisible();
});

test('admin can remove a period', async () => {
  const admin = await adminApi();
  const solo = await makeClassroom(admin, { students: 0 });
  const { page } = await sessions.open(adminUser);
  const tt = new TimetablePage(page);
  await tt.goto();
  await tt.chooseClass(`${solo.className} A`);
  await tt.addPeriod({ subjectLabel: solo.subjectName, day: 'Friday', start: '13:00', end: '13:40' });
  await expect(tt.period('Friday', '13:00')).toBeVisible();
  await tt.period('Friday', '13:00').getByRole('button', { name: 'Remove' }).click();
  await expect(tt.period('Friday', '13:00')).toHaveCount(0);
});

test('only admins get the scheduling form', async () => {
  const { page } = await sessions.open(room.teacher);
  await new TimetablePage(page).goto();
  await expect(page.getByRole('heading', { level: 2, name: 'Add a period' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(0);
});

test('an empty timetable shows a friendly message', async () => {
  const admin = await adminApi();
  const solo = await makeClassroom(admin, { students: 1 });
  const { page } = await sessions.open(solo.students[0]);
  await new TimetablePage(page).goto();
  await expect(page.getByText('No periods scheduled.')).toBeVisible();
});
