import { expect, test } from '@playwright/test';
import { adminApi, disposeApi, makeUser } from '../helpers/api';
import { ADMIN } from '../helpers/constants';
import { uid } from '../helpers/data';
import { Sessions } from '../helpers/session';
import { AcademicsPage } from '../page-objects/academics-page';
import { LoginPage, Shell } from '../page-objects/shell';

const adminUser = { email: ADMIN.email, password: ADMIN.password, name: ADMIN.name };
test.afterAll(disposeApi);

test.describe('classes, subjects and teaching assignments', () => {
  test('admin builds a class, a subject and assigns a teacher end to end', async ({ page }) => {
    const admin = await adminApi();
    const teacher = await makeUser(admin, 'teacher');
    const className = `Grade ${uid()}`;
    const subject = `Maths ${uid()}`;

    await new LoginPage(page).loginAs(adminUser);
    await new Shell(page).navigate('Classes & Subjects');
    const academics = new AcademicsPage(page);

    await academics.addClass(className, { section: 'B', year: '2099-00', classTeacher: teacher.name });
    await expect(academics.classRow(className)).toContainText(`${className} B`);
    await expect(academics.classRow(className)).toContainText(teacher.name);

    await academics.addSubject(subject, `M${uid()}`);
    await expect(academics.subjectRow(subject)).toBeVisible();

    await academics.assignTeacher(`${className} B`, subject, teacher.name);
    await expect(academics.assignmentRow(subject)).toContainText(teacher.name);
    await expect(academics.assignmentRow(subject)).toContainText(`${className} B`);
  });

  test('assigning a teacher is what gives them access to the class', async ({ page, browser }) => {
    const admin = await adminApi();
    const teacher = await makeUser(admin, 'teacher');
    const className = `Access ${uid()}`;
    const subject = `Art ${uid()}`;

    await new LoginPage(page).loginAs(adminUser);
    await new Shell(page).navigate('Classes & Subjects');
    const academics = new AcademicsPage(page);
    await academics.addClass(className);
    await academics.addSubject(subject, `A${uid()}`);
    await expect(academics.classRow(className)).toBeVisible();

    // before assignment the teacher sees no classes on the register
    const sessions = new Sessions(browser);
    const tp = await sessions.blank();
    await new LoginPage(tp).goto();
    await new LoginPage(tp).signIn(teacher.email, teacher.password);
    await new Shell(tp).navigate('Attendance');
    await expect(tp.getByText(/not assigned to any class/i)).toBeVisible();

    await academics.assignTeacher(`${className} A`, subject, teacher.name);
    await expect(academics.assignmentRow(subject)).toContainText(teacher.name);

    await tp.reload();
    await expect(tp.getByLabel('Class')).toContainText(className);
    await sessions.closeAll();
  });

  test('duplicate class and subject codes are rejected with a clear message', async ({ page }) => {
    const className = `Dup ${uid()}`;
    const code = `D${uid()}`;
    await new LoginPage(page).loginAs(adminUser);
    await new Shell(page).navigate('Classes & Subjects');
    const academics = new AcademicsPage(page);

    await academics.addClass(className, { section: 'A', year: '2099-00' });
    await expect(academics.classRow(className)).toBeVisible();
    await academics.addClass(className, { section: 'A', year: '2099-00' });
    await expect(academics.error().first()).toContainText('That record already exists');

    await academics.addSubject(`Sub ${uid()}`, code);
    await academics.addSubject(`Other ${uid()}`, code);
    await expect(academics.error().first()).toContainText('That record already exists');
  });

  test('deleting a class asks for confirmation', async ({ page }) => {
    const className = `Gone ${uid()}`;
    await new LoginPage(page).loginAs(adminUser);
    await new Shell(page).navigate('Classes & Subjects');
    const academics = new AcademicsPage(page);
    await academics.addClass(className);
    await expect(academics.classRow(className)).toBeVisible();

    page.once('dialog', (d) => d.dismiss());
    await academics.classRow(className).getByRole('button', { name: 'Delete' }).click();
    await expect(academics.classRow(className)).toBeVisible();

    await academics.deleteClass(className);
    await expect(academics.classRow(className)).toHaveCount(0);
  });

  test('admin dashboard totals reflect the school', async ({ page }) => {
    const admin = await adminApi();
    await makeUser(admin, 'teacher');
    await new LoginPage(page).loginAs(adminUser);
    for (const label of ['Students', 'Teachers', 'Parents', 'Classes', 'Fees collected', 'Fees outstanding']) {
      await expect(page.locator('.stat').filter({ hasText: label }).first()).toBeVisible();
    }
    await expect(page.getByRole('heading', { level: 2, name: 'Students per class' })).toBeVisible();
  });
});
