import { expect, test } from '@playwright/test';
import { adminApi, disposeApi, linkParent, makeClassroom, makeUser, Classroom, Person } from '../helpers/api';
import { Sessions } from '../helpers/session';
import { AttendanceHistoryPage, AttendanceRegisterPage } from '../page-objects/attendance-page';

let room: Classroom;
let parent: Person;
let sessions: Sessions;

test.beforeAll(async () => {
  const admin = await adminApi();
  room = await makeClassroom(admin, { students: 3, studentNames: ['Asha Attend', 'Bilal Absent', 'Chitra Late'].map((n) => `${n} ${Date.now() % 100000}`) });
  parent = await makeUser(admin, 'parent');
  await linkParent(admin, parent, room.students[1]);
});
test.afterAll(disposeApi);
test.beforeEach(({ browser }) => {
  sessions = new Sessions(browser);
});
test.afterEach(async () => sessions.closeAll());

test('teacher takes the register; students and parents see the result with correct percentages', async () => {
  const [asha, bilal, chitra] = room.students;
  const { page: tp } = await sessions.open(room.teacher);
  const register = new AttendanceRegisterPage(tp);
  await register.goto();
  await expect(tp.getByLabel('Class')).toContainText(room.className);
  await expect(register.row(asha.name)).toBeVisible();

  await register.mark(asha.name, 'present');
  await register.mark(bilal.name, 'absent');
  await register.mark(chitra.name, 'late');
  await register.save();
  await expect(register.saved()).toBeVisible();

  // persisted: a reload shows the same marks
  await tp.reload();
  await expect(register.row(asha.name).getByRole('radio', { name: 'present' })).toBeChecked();
  expect(await register.statusOf(bilal.name)).toBe('absent');
  expect(await register.statusOf(chitra.name)).toBe('late');

  // student view
  const { page: sp } = await sessions.open(bilal);
  const history = new AttendanceHistoryPage(sp);
  await history.goto();
  await expect(history.stat('Attendance')).toHaveText('0%');
  await expect(history.stat('absent')).toHaveText('1');
  await expect(history.historyRows()).toHaveCount(1);
  await expect(history.historyRows().first()).toContainText('absent');

  // a late arrival still counts as attending
  const { page: cp } = await sessions.open(chitra);
  await new AttendanceHistoryPage(cp).goto();
  await expect(new AttendanceHistoryPage(cp).stat('Attendance')).toHaveText('100%');
  await expect(new AttendanceHistoryPage(cp).stat('late')).toHaveText('1');

  // parent view of the linked child
  const { page: pp, shell } = await sessions.open(parent);
  await new AttendanceHistoryPage(pp).goto();
  await expect(shell.childSwitcher()).toContainText(bilal.name);
  await expect(new AttendanceHistoryPage(pp).stat('absent')).toHaveText('1');
});

test('"Mark all present" fills every row, and the unmarked counter updates', async () => {
  const { page } = await sessions.open(room.teacher);
  const register = new AttendanceRegisterPage(page);
  await register.goto();
  await expect(register.row(room.students[0].name)).toBeVisible();
  await register.setDate('2000-01-03');
  await expect(page.getByText('3 not marked yet')).toBeVisible();
  await register.markAllPresent();
  for (const s of room.students) expect(await register.statusOf(s.name)).toBe('present');
  await expect(page.getByText(/not marked yet/)).toHaveCount(0);
  await register.save();
  await expect(register.saved()).toBeVisible();
});

test('changing a mark and saving again updates the record instead of duplicating it', async () => {
  const [asha] = room.students;
  const { page } = await sessions.open(room.teacher);
  const register = new AttendanceRegisterPage(page);
  await register.goto();
  await register.setDate('2000-02-07');
  await register.mark(asha.name, 'absent');
  await register.save();
  await expect(register.saved()).toBeVisible();
  await register.mark(asha.name, 'excused');
  await register.save();
  await expect(register.saved()).toBeVisible();

  await page.reload();
  await register.setDate('2000-02-07');
  await expect.poll(() => register.statusOf(asha.name)).toBe('excused');
});

test('the save button is disabled until at least one student is marked', async () => {
  const { page } = await sessions.open(room.teacher);
  const register = new AttendanceRegisterPage(page);
  await register.goto();
  await register.setDate('2000-03-06');
  await expect(page.getByRole('button', { name: 'Save attendance' })).toBeDisabled();
  await register.mark(room.students[0].name, 'present');
  await expect(page.getByRole('button', { name: 'Save attendance' })).toBeEnabled();
});

test('a teacher only sees their own classes in the register', async () => {
  const admin = await adminApi();
  const other = await makeClassroom(admin, { students: 1 });
  const { page } = await sessions.open(other.teacher);
  await new AttendanceRegisterPage(page).goto();
  const options = page.getByLabel('Class').locator('option');
  await expect(options).toHaveCount(1);
  await expect(options.first()).toContainText(other.className);
  await expect(page.getByLabel('Class')).not.toContainText(room.className);
});

test('a student with no records sees an empty state, not a broken page', async () => {
  const admin = await adminApi();
  const fresh = await makeClassroom(admin, { students: 1 });
  const { page } = await sessions.open(fresh.students[0]);
  const history = new AttendanceHistoryPage(page);
  await history.goto();
  await expect(history.stat('Attendance')).toHaveText('—');
  await expect(page.getByText('No attendance recorded yet.')).toBeVisible();
});
