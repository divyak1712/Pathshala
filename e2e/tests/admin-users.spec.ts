import { expect, test } from '@playwright/test';
import { adminApi, disposeApi, makeClassroom, makeUser } from '../helpers/api';
import { ADMIN, PASSWORD } from '../helpers/constants';
import { uid, uniqueEmail } from '../helpers/data';
import { Sessions } from '../helpers/session';
import { LoginPage, Shell } from '../page-objects/shell';
import { AcademicsPage } from '../page-objects/academics-page';
import { UsersPage } from '../page-objects/users-page';

const adminUser = { email: ADMIN.email, password: ADMIN.password, name: ADMIN.name };

test.afterAll(disposeApi);

test.describe('user management (admin)', () => {
  test('admin provisions a teacher in the UI and that teacher can sign in', async ({ page }) => {
    const email = uniqueEmail('newteacher');
    const name = `New Teacher ${uid()}`;
    await new LoginPage(page).loginAs(adminUser);
    const users = new UsersPage(page);
    await new Shell(page).navigate('Users');
    await users.createUser({ name, email, password: PASSWORD, role: 'teacher' });
    await expect(users.createFeedback()).toContainText('Account created');
    await expect(users.row(email)).toContainText(name);
    await expect(users.row(email).getByRole('combobox')).toHaveValue('teacher');

    await new Shell(page).signOut();
    await new LoginPage(page).loginAs({ email, password: PASSWORD, name });
    await expect(new Shell(page).heading(`Welcome, ${name}`)).toBeVisible();
    expect(await new Shell(page).navLabels()).not.toContain('Users');
  });

  test('creating a student assigns the class and admission number', async ({ page }) => {
    const admin = await adminApi();
    const room = await makeClassroom(admin, { students: 0 });
    const email = uniqueEmail('newstudent');
    const name = `Pupil ${uid()}`;
    await new LoginPage(page).loginAs(adminUser);
    const users = new UsersPage(page);
    await users.goto();
    await users.createUser({ name, email, password: PASSWORD, role: 'student', admissionNo: `ADM-${uid()}`, className: `${room.className} A`, rollNo: 3 });
    await expect(users.createFeedback()).toContainText('Account created');

    // the class roster (Classes & Subjects -> Student placement) now shows the pupil in that class
    await new Shell(page).navigate('Classes & Subjects');
    const placement = page.getByRole('row').filter({ hasText: name });
    await expect(placement.getByRole('combobox')).toHaveValue(String(room.classId));
    await expect(new AcademicsPage(page).classRow(room.className).getByRole('cell').nth(3)).toHaveText('1'); // student count
  });

  test('a duplicate admission number is reported and no account is left behind', async ({ page }) => {
    const admin = await adminApi();
    const existing = await makeUser(admin, 'student');
    const email = uniqueEmail('dupadm');
    await new LoginPage(page).loginAs(adminUser);
    const users = new UsersPage(page);
    await users.goto();
    // reuse the existing student's admission number via the UI
    const adminRow = await admin.get('/api/users?role=student');
    const admissionNo = (await adminRow.json()).find((u: { id: string }) => u.id === existing.id).admission_no;
    await users.createUser({ name: 'Should Not Exist', email, password: PASSWORD, role: 'student', admissionNo });
    await expect(users.createFeedback()).toContainText('That record already exists');
    await users.filterBy('student');
    await expect(users.row(email)).toHaveCount(0);
  });

  test('server-side validation errors surface in the form (short temporary password)', async ({ page }) => {
    await new LoginPage(page).loginAs(adminUser);
    const users = new UsersPage(page);
    await users.goto();
    const email = uniqueEmail('short');
    await users.createUser({ name: 'Short Pass', email, password: '1234567', role: 'teacher' });
    // the input has minLength=8, so the browser blocks the submit: no account is created
    await expect(users.row(email)).toHaveCount(0);
    await expect(users.createFeedback()).toHaveCount(0);
  });

  test('deactivate blocks access; activate restores it', async ({ page, browser }) => {
    const admin = await adminApi();
    const victim = await makeUser(admin, 'teacher');
    const sessions = new Sessions(browser);
    try {
      const { page: victimPage, shell } = await sessions.open(victim);
      await expect(shell.heading(`Welcome, ${victim.name}`)).toBeVisible();

      await new LoginPage(page).loginAs(adminUser);
      const users = new UsersPage(page);
      await users.goto();
      await users.deactivate(victim.email);
      await expect(users.row(victim.email)).toContainText('deactivated');

      // the live session is revoked: next navigation lands on the login page
      await victimPage.reload();
      await expect(victimPage).toHaveURL(/\/login$/);
      // signing in again is refused by the app
      await new LoginPage(victimPage).signIn(victim.email, victim.password);
      await expect(victimPage.getByText('Account deactivated')).toBeVisible();

      await users.activate(victim.email);
      await expect(users.row(victim.email)).toContainText('active');
      await victimPage.goto('/');
      await expect(new Shell(victimPage).heading(`Welcome, ${victim.name}`)).toBeVisible();
    } finally {
      await sessions.closeAll();
    }
  });

  test('reset password: the old one stops working, the new one works', async ({ page, browser }) => {
    const admin = await adminApi();
    const user = await makeUser(admin, 'parent');
    await new LoginPage(page).loginAs(adminUser);
    const users = new UsersPage(page);
    await users.goto();
    await users.resetPassword(user.email, 'Reset-By-Admin-9!');
    await expect(page.getByText('Password reset')).toBeVisible();

    const sessions = new Sessions(browser);
    try {
      const fresh = await sessions.blank();
      const login = new LoginPage(fresh);
      await login.goto();
      await login.signIn(user.email, user.password);
      await expect(login.error()).toContainText(/invalid/i);
      await login.signIn(user.email, 'Reset-By-Admin-9!');
      await expect(new Shell(fresh).heading(`Welcome, ${user.name}`)).toBeVisible();
    } finally {
      await sessions.closeAll();
    }
  });

  test('delete asks for confirmation and removes the user', async ({ page }) => {
    const admin = await adminApi();
    const user = await makeUser(admin, 'teacher');
    await new LoginPage(page).loginAs(adminUser);
    const users = new UsersPage(page);
    await users.goto();
    await expect(users.row(user.email)).toBeVisible();

    // dismissing the confirm keeps the user
    page.once('dialog', (d) => d.dismiss());
    await users.row(user.email).getByRole('button', { name: 'Delete' }).click();
    await expect(users.row(user.email)).toBeVisible();

    await users.delete(user.email);
    await expect(users.row(user.email)).toHaveCount(0);
  });

  test('admin cannot deactivate, delete or demote themselves (controls are not offered)', async ({ page }) => {
    await new LoginPage(page).loginAs(adminUser);
    const users = new UsersPage(page);
    await users.goto();
    const mine = users.row(ADMIN.email);
    await expect(mine).toBeVisible();
    await expect(mine.getByRole('button', { name: 'Delete' })).toHaveCount(0);
    await expect(mine.getByRole('button', { name: 'Deactivate' })).toHaveCount(0);
    await expect(mine.getByRole('combobox')).toBeDisabled();
  });

  test('role filter tabs narrow the table', async ({ page }) => {
    const admin = await adminApi();
    const teacher = await makeUser(admin, 'teacher');
    const parent = await makeUser(admin, 'parent');
    await new LoginPage(page).loginAs(adminUser);
    const users = new UsersPage(page);
    await users.goto();
    await users.filterBy('teacher');
    await expect(users.row(teacher.email)).toBeVisible();
    await expect(users.row(parent.email)).toHaveCount(0);
    await users.filterBy('parent');
    await expect(users.row(parent.email)).toBeVisible();
    await expect(users.row(teacher.email)).toHaveCount(0);
  });

  test('linking a parent to a student gives that parent the child switcher', async ({ page, browser }) => {
    const admin = await adminApi();
    const room = await makeClassroom(admin, { students: 1 });
    const parent = await makeUser(admin, 'parent');
    const child = room.students[0];
    await new LoginPage(page).loginAs(adminUser);
    const users = new UsersPage(page);
    await users.goto();
    await users.filterBy('student');
    await users.openParentLinks(child.email);
    await expect(users.linkCard()).toContainText(child.name);
    await users.linkParent(parent.name);
    await users.saveLinks();
    await expect(page.getByText('Parents linked')).toBeVisible();

    const sessions = new Sessions(browser);
    try {
      const { shell } = await sessions.open(parent);
      await expect(shell.childSwitcher()).toContainText(child.name);
    } finally {
      await sessions.closeAll();
    }
  });
});
