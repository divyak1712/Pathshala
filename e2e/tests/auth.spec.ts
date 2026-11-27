import { expect, test } from '@playwright/test';
import { adminApi, disposeApi, makeClassroom, makeUser, linkParent, Person } from '../helpers/api';
import { ADMIN } from '../helpers/constants';
import { LoginPage, Shell } from '../page-objects/shell';
import { ProfilePage } from '../page-objects/profile-page';

let teacher: Person;
let student: Person;
let parent: Person;
let outsider: Person;

test.beforeAll(async () => {
  const admin = await adminApi();
  const room = await makeClassroom(admin, { students: 1 });
  teacher = room.teacher;
  student = room.students[0];
  parent = await makeUser(admin, 'parent');
  await linkParent(admin, parent, student);
  outsider = await makeUser(admin, 'teacher');
});
test.afterAll(disposeApi);

test.describe('sign in', () => {
  test('login page: branded, no self sign-up, explains accounts are admin-created', async ({ page }) => {
    await new LoginPage(page).goto();
    await expect(page.getByRole('heading', { name: 'Pathshala' })).toBeVisible();
    await expect(page.getByText(/accounts are created by your school administrator/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /sign ?up|register|create account/i })).toHaveCount(0);
  });

  test('wrong password shows an error and stays on the login page', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.signIn(teacher.email, 'not-the-password');
    await expect(login.error()).toContainText(/invalid/i);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
  });

  test('each role lands on its own personalised dashboard', async ({ page }) => {
    const login = new LoginPage(page);
    const shell = new Shell(page);
    for (const who of [teacher, student, parent]) {
      await login.loginAs(who);
      await expect(shell.heading(`Welcome, ${who.name}`)).toBeVisible();
      await expect(shell.userLink(who.name)).toBeVisible();
      await shell.signOut();
    }
    await login.loginAs({ email: ADMIN.email, password: ADMIN.password, name: ADMIN.name });
    await expect(shell.heading(`Welcome, ${ADMIN.name}`)).toBeVisible();
  });

  test('a deep link while signed out redirects to login, then returns to the page', async ({ page }) => {
    await page.goto('/fees');
    await expect(page).toHaveURL(/\/login$/);
    await new LoginPage(page).signIn(student.email, student.password);
    await expect(page).toHaveURL(/\/fees$/);
    await expect(new Shell(page).heading('Fees')).toBeVisible();
  });

  test('already signed in: visiting /login bounces to the dashboard', async ({ page }) => {
    await new LoginPage(page).loginAs(teacher);
    await page.goto('/login');
    await expect(new Shell(page).heading(/^Welcome,/)).toBeVisible();
  });
});

test.describe('sign out', () => {
  test('signing out ends the session; protected pages require login again', async ({ page }) => {
    await new LoginPage(page).loginAs(student);
    await new Shell(page).signOut();
    await page.goto('/attendance');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('a reload keeps the user signed in', async ({ page }) => {
    await new LoginPage(page).loginAs(teacher);
    await page.reload();
    await expect(new Shell(page).heading(`Welcome, ${teacher.name}`)).toBeVisible();
  });
});

test.describe('change password', () => {
  test('user changes password in Profile and must use the new one afterwards', async ({ page }) => {
    const admin = await adminApi();
    const user = await makeUser(admin, 'teacher');
    const login = new LoginPage(page);
    const profile = new ProfilePage(page);
    const next = 'Brand-New-Pass1!';

    await login.loginAs(user);
    await new Shell(page).userLink(user.name).click();
    await expect(page).toHaveURL(/\/profile$/);
    await profile.changePassword(user.password, next);
    await expect(profile.updated()).toBeVisible();
    await new Shell(page).signOut();

    await login.signIn(user.email, user.password);
    await expect(login.error()).toContainText(/invalid/i);
    await login.signIn(user.email, next);
    await expect(new Shell(page).heading(`Welcome, ${user.name}`)).toBeVisible();
  });

  test('a short new password is rejected with a message', async ({ page }) => {
    const admin = await adminApi();
    const user = await makeUser(admin, 'student');
    await new LoginPage(page).loginAs(user);
    const profile = new ProfilePage(page);
    await profile.goto();
    await profile.changePassword(user.password, 'short');
    await expect(profile.error()).toContainText('at least 8 characters');
  });

  test('wrong current password is rejected', async ({ page }) => {
    await new LoginPage(page).loginAs(outsider);
    const profile = new ProfilePage(page);
    await profile.goto();
    await profile.changePassword('definitely-wrong', 'Another-Pass-123');
    await expect(profile.error()).toBeVisible();
    await expect(profile.updated()).toHaveCount(0);
  });
});
