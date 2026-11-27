import { expect, test } from '@playwright/test';
import { addFee, adminApi, disposeApi, linkParent, makeClassroom, makeUser, Classroom, Person } from '../helpers/api';
import { uid } from '../helpers/data';
import { Sessions } from '../helpers/session';
import { statValue } from '../page-objects/shell';
import { MyFeesPage } from '../page-objects/fees-page';

let room: Classroom;
let parent: Person;
let lonely: Person;
let sessions: Sessions;

test.beforeAll(async () => {
  const admin = await adminApi();
  room = await makeClassroom(admin, { students: 2, studentNames: [`Elder ${Date.now() % 100000}`, `Younger ${Date.now() % 100000}`] });
  parent = await makeUser(admin, 'parent');
  await linkParent(admin, parent, room.students[0], room.students[1]);
  lonely = await makeUser(admin, 'parent'); // no children linked
});
test.afterAll(disposeApi);
test.beforeEach(({ browser }) => {
  sessions = new Sessions(browser);
});
test.afterEach(async () => sessions.closeAll());

test('a parent with two children switches between them and every page follows the selection', async () => {
  const [elder, younger] = room.students;
  const admin = await adminApi();
  const elderFee = `Elder fee ${uid()}`;
  const youngerFee = `Younger fee ${uid()}`;
  await addFee(admin, elder, elderFee, 100);
  await addFee(admin, younger, youngerFee, 700);

  const { page, shell } = await sessions.open(parent);
  await expect(shell.childSwitcher().locator('option')).toHaveCount(2);

  // dashboard tile follows the child
  await shell.chooseChild(elder.name);
  await expect(page.getByText(`Showing ${elder.name}`)).toBeVisible();
  await expect(statValue(page, 'Fees outstanding')).toContainText(/₹\s?100/);
  await shell.chooseChild(younger.name);
  await expect(page.getByText(`Showing ${younger.name}`)).toBeVisible();
  await expect(statValue(page, 'Fees outstanding')).toContainText(/₹\s?700/);

  // and so does the Fees page, which shows only the selected child's bills
  await shell.navigate('Fees');
  const fees = new MyFeesPage(page);
  await expect(fees.fee(youngerFee)).toBeVisible();
  await expect(fees.fee(elderFee)).toHaveCount(0);
  await shell.chooseChild(elder.name);
  await expect(fees.fee(elderFee)).toBeVisible();
  await expect(fees.fee(youngerFee)).toHaveCount(0);
});

test('the selected child survives navigation within the session', async () => {
  const [elder] = room.students;
  const { shell } = await sessions.open(parent);
  await shell.chooseChild(elder.name);
  await shell.navigate('Grades');
  await shell.navigate('Attendance');
  await expect(shell.childSwitcher().locator('option:checked')).toContainText(elder.name);
});

test('a parent with no linked children is told so, and nothing breaks', async () => {
  const { page, shell } = await sessions.open(lonely);
  await expect(page.getByText(/no children are linked to your account/i)).toBeVisible();
  await expect(shell.childSwitcher()).toContainText('No children linked');
  await shell.navigate('Fees');
  await expect(shell.heading('Fees')).toBeVisible();
  await expect(page.getByText('No fees have been billed.')).toBeVisible();
});
