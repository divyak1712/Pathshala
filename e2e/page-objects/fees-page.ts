import { Locator, Page } from '@playwright/test';
import { card } from './shell';

export class AdminFeesPage {
  constructor(private page: Page) {}
  async goto() {
    await this.page.goto('/fees');
  }
  async billClass(a: { className: string; title: string; amount: number; dueDate: string }) {
    const c = card(this.page, 'Create fee');
    await c.getByLabel('Bill').selectOption('class');
    await c.getByLabel('Class').selectOption({ label: a.className });
    await c.getByLabel('Title').fill(a.title);
    await c.getByLabel('Amount').fill(String(a.amount));
    await c.getByLabel('Due').fill(a.dueDate);
    await c.getByRole('button', { name: 'Create' }).click();
  }
  async billStudent(a: { studentLabel: string | RegExp; title: string; amount: number; dueDate: string }) {
    const c = card(this.page, 'Create fee');
    await c.getByLabel('Bill').selectOption('student');
    const select = c.getByLabel('Student');
    const label = await select.locator('option', { hasText: a.studentLabel }).first().innerText();
    await select.selectOption({ label });
    await c.getByLabel('Title').fill(a.title);
    await c.getByLabel('Amount').fill(String(a.amount));
    await c.getByLabel('Due').fill(a.dueDate);
    await c.getByRole('button', { name: 'Create' }).click();
  }
  created(): Locator {
    return this.page.getByText('Fees created');
  }
  ledgerRow(studentName: string, title: string): Locator {
    return card(this.page, 'Fee ledger').getByRole('row').filter({ hasText: studentName }).filter({ hasText: title });
  }
  async filter(status: 'all' | 'pending' | 'overdue' | 'paid') {
    await this.page.getByRole('button', { name: status, exact: true }).click();
  }
  /** Record payment uses two native prompt()s: amount, then method. */
  async recordPayment(studentName: string, title: string, amount: number, method = 'cash') {
    const answers = [String(amount), method];
    const handler = (d: import('@playwright/test').Dialog) => {
      const next = answers.shift();
      return next === undefined ? d.dismiss() : d.accept(next);
    };
    this.page.on('dialog', handler);
    await this.ledgerRow(studentName, title).getByRole('button', { name: 'Record payment' }).click();
    await this.page.getByText('Payment recorded').waitFor();
    this.page.off('dialog', handler);
  }
  error(): Locator {
    return this.page.getByRole('alert');
  }
  stat(label: string): Locator {
    return this.page.locator('.stat').filter({ has: this.page.getByText(label, { exact: true }) }).locator('.stat-value');
  }
}

export class MyFeesPage {
  constructor(private page: Page) {}
  async goto() {
    await this.page.goto('/fees');
  }
  fee(title: string): Locator {
    return this.page.locator('section.card').filter({ has: this.page.getByRole('heading', { level: 2, name: title }) });
  }
  async payOnline(title: string) {
    await this.fee(title).getByRole('button', { name: /online/i }).click();
  }
  error(): Locator {
    return this.page.getByRole('alert');
  }
}
