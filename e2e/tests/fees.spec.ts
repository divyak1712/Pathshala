import { expect, test } from '@playwright/test';
import { addFee, adminApi, disposeApi, linkParent, makeClassroom, makeUser, Classroom, Person } from '../helpers/api';
import { ADMIN } from '../helpers/constants';
import { daysFromToday, uid } from '../helpers/data';
import { Sessions } from '../helpers/session';
import { AdminFeesPage, MyFeesPage } from '../page-objects/fees-page';

const adminUser = { email: ADMIN.email, password: ADMIN.password, name: ADMIN.name };
let room: Classroom;
let parent: Person;
let sessions: Sessions;

test.beforeAll(async () => {
  const admin = await adminApi();
  room = await makeClassroom(admin, { students: 2, studentNames: [`Fiona Fee ${Date.now() % 100000}`, `Gopal Gold ${Date.now() % 100000}`] });
  parent = await makeUser(admin, 'parent');
  await linkParent(admin, parent, room.students[0]);
});
test.afterAll(disposeApi);
test.beforeEach(({ browser }) => {
  sessions = new Sessions(browser);
});
test.afterEach(async () => sessions.closeAll());

test('admin bills a class, records a part payment; student and parent see the balance', async () => {
  const [fiona, gopal] = room.students;
  const title = `Term fee ${uid()}`;

  const { page: ap } = await sessions.open(adminUser);
  const fees = new AdminFeesPage(ap);
  await fees.goto();
  await fees.billClass({ className: `${room.className} A`, title, amount: 1000, dueDate: daysFromToday(30) });
  await expect(fees.created()).toBeVisible();
  await expect(fees.ledgerRow(fiona.name, title)).toContainText('pending');
  await expect(fees.ledgerRow(gopal.name, title)).toContainText('pending');

  await fees.recordPayment(fiona.name, title, 400, 'upi');
  await expect(fees.ledgerRow(fiona.name, title)).toContainText(/₹\s?400/);
  await expect(fees.ledgerRow(fiona.name, title)).toContainText('pending'); // still part-paid
  await expect(fees.ledgerRow(gopal.name, title)).toContainText(/₹\s?0/);

  // student view: billed 1000, paid 400, balance 600, with the payment listed
  const { page: sp } = await sessions.open(fiona);
  const mine = new MyFeesPage(sp);
  await mine.goto();
  await expect(mine.fee(title)).toContainText(/balance\s*₹\s?600/);
  await expect(mine.fee(title)).toContainText(/₹\s?400 via upi/);
  await expect(mine.fee(title).getByRole('button', { name: /pay.*online/i })).toBeVisible();

  // the parent sees their child's bill, not the other student's
  const { page: pp } = await sessions.open(parent);
  const asParent = new MyFeesPage(pp);
  await asParent.goto();
  await expect(asParent.fee(title)).toContainText(/balance\s*₹\s?600/);

  // paying the remainder marks it paid and removes the pay button
  await fees.recordPayment(fiona.name, title, 600);
  await expect(fees.ledgerRow(fiona.name, title)).toContainText('paid');
  await mine.goto();
  await expect(mine.fee(title)).toContainText(/balance\s*₹\s?0/);
  await expect(mine.fee(title).getByRole('button', { name: /online/i })).toHaveCount(0);
});

test('overpaying is rejected and the ledger is unchanged', async () => {
  const [, gopal] = room.students;
  const title = `Overpay ${uid()}`;
  const { page } = await sessions.open(adminUser);
  const fees = new AdminFeesPage(page);
  await fees.goto();
  await fees.billStudent({ studentLabel: gopal.name, title, amount: 500, dueDate: daysFromToday(10) });
  await expect(fees.created()).toBeVisible();

  const answers = ['900', 'cash'];
  const handler = (d: import('@playwright/test').Dialog) => d.accept(answers.shift());
  page.on('dialog', handler);
  await fees.ledgerRow(gopal.name, title).getByRole('button', { name: 'Record payment' }).click();
  await expect(fees.error()).toContainText('Amount exceeds outstanding balance (500)');
  page.off('dialog', handler);
  await expect(fees.ledgerRow(gopal.name, title)).toContainText(/₹\s?0/);
});

test('past-due unpaid fees are flagged overdue and can be filtered', async () => {
  const [fiona] = room.students;
  const admin = await adminApi();
  const title = `Late ${uid()}`;
  await addFee(admin, fiona, title, 250, -5);
  const { page } = await sessions.open(adminUser);
  const fees = new AdminFeesPage(page);
  await fees.goto();
  await expect(fees.ledgerRow(fiona.name, title)).toContainText('overdue');
  await fees.filter('overdue');
  await expect(fees.ledgerRow(fiona.name, title)).toBeVisible();
  await fees.filter('paid');
  await expect(fees.ledgerRow(fiona.name, title)).toHaveCount(0);
});

test('summary tiles move by the billed and collected amounts', async () => {
  const admin = await adminApi();
  const solo = await makeClassroom(admin, { students: 1 });
  const { page } = await sessions.open(adminUser);
  const fees = new AdminFeesPage(page);
  await fees.goto();
  const parse = async (label: string) => Number((await fees.stat(label).innerText()).replace(/[^\d.]/g, ''));
  await expect(fees.stat('Billed')).toContainText('₹');
  const billedBefore = await parse('Billed');
  const collectedBefore = await parse('Collected');

  const title = `Tile ${uid()}`;
  await fees.billStudent({ studentLabel: solo.students[0].name, title, amount: 777, dueDate: daysFromToday(20) });
  await expect(fees.created()).toBeVisible();
  await fees.recordPayment(solo.students[0].name, title, 111);
  await expect.poll(() => parse('Billed')).toBe(billedBefore + 777);
  await expect.poll(() => parse('Collected')).toBe(collectedBefore + 111);
});

test('online payment explains that it is not configured instead of failing silently', async () => {
  const admin = await adminApi();
  const solo = await makeClassroom(admin, { students: 1 });
  const title = `Online ${uid()}`;
  await addFee(admin, solo.students[0], title, 300);
  const { page } = await sessions.open(solo.students[0]);
  const mine = new MyFeesPage(page);
  await mine.goto();
  await mine.payOnline(title);
  await expect(mine.error()).toContainText(/online payments are not configured/i);
  await expect(page).toHaveURL(/\/fees$/); // no redirect to a payment provider
});

test('students without fees see an empty state; teachers have no Fees page at all', async () => {
  const admin = await adminApi();
  const solo = await makeClassroom(admin, { students: 1 });
  const { page } = await sessions.open(solo.students[0]);
  await new MyFeesPage(page).goto();
  await expect(page.getByText('No fees have been billed.')).toBeVisible();

  const { shell: tshell } = await sessions.open(solo.teacher);
  await expect(tshell.navLink('Fees')).toHaveCount(0);
});
