import { expect, test } from '@playwright/test';
import { adminApi, disposeApi, linkParent, makeClassroom, makeUser, Person } from '../helpers/api';
import { ADMIN } from '../helpers/constants';
import { LoginPage, Shell } from '../page-objects/shell';

let teacher: Person;
let student: Person;
let parent: Person;
const adminUser = { email: ADMIN.email, password: ADMIN.password, name: ADMIN.name };

test.beforeAll(async () => {
  const admin = await adminApi();
  const room = await makeClassroom(admin, { students: 1 });
  teacher = room.teacher;
  student = room.students[0];
  parent = await makeUser(admin, 'parent');
  await linkParent(admin, parent, student);
});
test.afterAll(disposeApi);

const NAV = {
  admin: ['Dashboard', 'Users', 'Classes & Subjects', 'Timetable', 'Attendance', 'Fees', 'Announcements'],
  teacher: ['Dashboard', 'Attendance', 'Gradebook', 'Assignments', 'My Timetable', 'Announcements'],
  family: ['Dashboard', 'Attendance', 'Grades', 'Assignments', 'Timetable', 'Fees', 'Announcements'],
};

test.describe('navigation is role-specific', () => {
  test('admin menu', async ({ page }) => {
    await new LoginPage(page).loginAs(adminUser);
    expect(await new Shell(page).navLabels()).toEqual(NAV.admin);
  });
  test('teacher menu', async ({ page }) => {
    await new LoginPage(page).loginAs(teacher);
    expect(await new Shell(page).navLabels()).toEqual(NAV.teacher);
  });
  test('student and parent menus', async ({ page }) => {
    const login = new LoginPage(page);
    await login.loginAs(student);
    expect(await new Shell(page).navLabels()).toEqual(NAV.family);
    await new Shell(page).signOut();
    await login.loginAs(parent);
    expect(await new Shell(page).navLabels()).toEqual(NAV.family);
  });
  test('only parents get the child switcher', async ({ page }) => {
    const login = new LoginPage(page);
    await login.loginAs(student);
    await expect(new Shell(page).childSwitcher()).toHaveCount(0);
    await new Shell(page).signOut();
    await login.loginAs(parent);
    await expect(new Shell(page).childSwitcher()).toBeVisible();
  });
});

test.describe('typing a forbidden URL sends you back to your dashboard', () => {
  const cases: Array<[string, () => Person | typeof adminUser, string]> = [
    ['student -> /users', () => student, '/users'],
    ['student -> /academics', () => student, '/academics'],
    ['parent -> /users', () => parent, '/users'],
    ['teacher -> /users', () => teacher, '/users'],
    ['teacher -> /fees', () => teacher, '/fees'],
    ['teacher -> /academics', () => teacher, '/academics'],
    ['admin -> /grades', () => adminUser, '/grades'],
    ['admin -> /assignments', () => adminUser, '/assignments'],
  ];
  for (const [label, who, path] of cases) {
    test(label, async ({ page }) => {
      await new LoginPage(page).loginAs(who());
      await page.goto(path);
      await expect(new Shell(page).heading(/^Welcome,/)).toBeVisible();
      await expect(page).not.toHaveURL(new RegExp(`${path}$`));
    });
  }

  test('an unknown path falls back to the dashboard', async ({ page }) => {
    await new LoginPage(page).loginAs(student);
    await page.goto('/this/does/not/exist');
    await expect(new Shell(page).heading(/^Welcome,/)).toBeVisible();
  });
});

test.describe('shared pages render the right variant per role', () => {
  test('Attendance: teachers get the register, students get their history', async ({ page }) => {
    const login = new LoginPage(page);
    await login.loginAs(teacher);
    await new Shell(page).navigate('Attendance');
    await expect(new Shell(page).heading('Attendance register')).toBeVisible();
    await new Shell(page).signOut();
    await login.loginAs(student);
    await new Shell(page).navigate('Attendance');
    await expect(new Shell(page).heading('Attendance')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Attendance register' })).toHaveCount(0);
  });

  test('Fees: admin sees the ledger, a student sees only their own bills', async ({ page }) => {
    const login = new LoginPage(page);
    await login.loginAs(adminUser);
    await new Shell(page).navigate('Fees');
    await expect(page.getByRole('heading', { level: 2, name: 'Fee ledger' })).toBeVisible();
    await new Shell(page).signOut();
    await login.loginAs(student);
    await new Shell(page).navigate('Fees');
    await expect(page.getByRole('heading', { level: 2, name: 'Fee ledger' })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 2, name: 'Create fee' })).toHaveCount(0);
  });
});
