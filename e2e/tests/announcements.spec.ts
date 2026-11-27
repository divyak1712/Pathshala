import { expect, test } from '@playwright/test';
import { adminApi, disposeApi, linkParent, makeClassroom, makeUser, Classroom, Person } from '../helpers/api';
import { ADMIN } from '../helpers/constants';
import { uid } from '../helpers/data';
import { Sessions } from '../helpers/session';
import { AnnouncementsPage } from '../page-objects/announcements-page';

const adminUser = { email: ADMIN.email, password: ADMIN.password, name: ADMIN.name };
let room: Classroom;
let other: Classroom;
let parent: Person;
let sessions: Sessions;

test.beforeAll(async () => {
  const admin = await adminApi();
  room = await makeClassroom(admin, { students: 1 });
  other = await makeClassroom(admin, { students: 1 });
  parent = await makeUser(admin, 'parent');
  await linkParent(admin, parent, room.students[0]);
});
test.afterAll(disposeApi);
test.beforeEach(({ browser }) => {
  sessions = new Sessions(browser);
});
test.afterEach(async () => sessions.closeAll());

test('an admin broadcast to everyone reaches every role', async () => {
  const title = `Holiday ${uid()}`;
  const { page: ap } = await sessions.open(adminUser);
  const admin = new AnnouncementsPage(ap);
  await admin.goto();
  await admin.publish({ title, message: 'School is closed on Monday.', audience: 'Everyone' });
  await expect(admin.published()).toBeVisible();

  for (const who of [room.students[0], parent, room.teacher, other.students[0]]) {
    const { page } = await sessions.open(who);
    const view = new AnnouncementsPage(page);
    await view.goto();
    await expect(view.item(title)).toContainText('School is closed on Monday.');
    await expect(view.item(title)).toContainText('everyone');
  }
});

test('audience targeting: parents-only notices are hidden from students', async () => {
  const title = `Parents evening ${uid()}`;
  const { page: ap } = await sessions.open(adminUser);
  const admin = new AnnouncementsPage(ap);
  await admin.goto();
  await admin.publish({ title, message: 'Meet the teachers on Friday.', audience: 'Parents' });
  await expect(admin.published()).toBeVisible();

  const { page: pp } = await sessions.open(parent);
  await new AnnouncementsPage(pp).goto();
  await expect(new AnnouncementsPage(pp).item(title)).toBeVisible();

  const { page: sp } = await sessions.open(room.students[0]);
  await new AnnouncementsPage(sp).goto();
  await expect(new AnnouncementsPage(sp).item(title)).toHaveCount(0);
});

test('a teacher announces to their own class only: that class sees it, another class does not', async () => {
  const title = `Quiz Friday ${uid()}`;
  const { page: tp } = await sessions.open(room.teacher);
  const teacher = new AnnouncementsPage(tp);
  await teacher.goto();
  await expect(tp.getByLabel('Audience')).not.toContainText('Teachers'); // teachers can't address teachers
  await teacher.publish({ title, message: 'Revise chapter 3.', audience: 'Students', classLabel: `${room.className} A` });
  await expect(teacher.published()).toBeVisible();
  await expect(teacher.item(title)).toContainText(`${room.className} A`);

  const { page: sp } = await sessions.open(room.students[0]);
  await new AnnouncementsPage(sp).goto();
  await expect(new AnnouncementsPage(sp).item(title)).toBeVisible();

  const { page: op } = await sessions.open(other.students[0]);
  await new AnnouncementsPage(op).goto();
  await expect(new AnnouncementsPage(op).item(title)).toHaveCount(0);

  // the teacher's class picker only offers their own class
  await expect(tp.getByLabel(/^Class/)).toContainText(room.className);
  await expect(tp.getByLabel(/^Class/)).not.toContainText(other.className);
});

test('students and parents can read but not post', async () => {
  for (const who of [room.students[0], parent]) {
    const { page } = await sessions.open(who);
    const view = new AnnouncementsPage(page);
    await view.goto();
    await expect(page.getByRole('heading', { level: 1, name: 'Announcements' })).toBeVisible();
    await expect(view.canPost()).toHaveCount(0);
  }
});

test('teachers can delete their own announcements but not the admin\'s; admin can delete any', async () => {
  const mine = `Mine ${uid()}`;
  const school = `School ${uid()}`;
  const { page: ap } = await sessions.open(adminUser);
  const admin = new AnnouncementsPage(ap);
  await admin.goto();
  await admin.publish({ title: school, message: 'From the office.', audience: 'Everyone' });
  await expect(admin.published()).toBeVisible();

  const { page: tp } = await sessions.open(room.teacher);
  const teacher = new AnnouncementsPage(tp);
  await teacher.goto();
  await teacher.publish({ title: mine, message: 'Class note.', audience: 'Everyone', classLabel: `${room.className} A` });
  await expect(teacher.published()).toBeVisible();

  await expect(teacher.item(mine).getByRole('button', { name: 'Delete' })).toBeVisible();
  await expect(teacher.item(school).getByRole('button', { name: 'Delete' })).toHaveCount(0);

  await teacher.delete(mine);
  await expect(teacher.item(mine)).toHaveCount(0);

  await admin.goto();
  await expect(admin.item(school)).toBeVisible();
  await admin.delete(school);
  await expect(admin.item(school)).toHaveCount(0);
});

test('a teacher must pick a class (the form blocks a school-wide post)', async () => {
  const { page } = await sessions.open(room.teacher);
  const teacher = new AnnouncementsPage(page);
  await teacher.goto();
  const title = `No class ${uid()}`;
  await teacher.publish({ title, message: 'Should not post.' });
  await expect(teacher.published()).toHaveCount(0);
  await expect(teacher.item(title)).toHaveCount(0);
});
