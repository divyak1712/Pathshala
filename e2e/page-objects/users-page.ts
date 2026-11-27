import { Locator, Page } from '@playwright/test';
import { card } from './shell';

export class UsersPage {
  constructor(private page: Page) {}
  async goto() {
    await this.page.goto('/users');
  }
  private createCard() {
    return card(this.page, 'Create account');
  }

  /** Fills the "Create account" form and submits. `className` is the visible class option text. */
  async createUser(u: { name: string; email: string; password: string; role: string; admissionNo?: string; className?: string; rollNo?: number }) {
    const form = this.createCard();
    await form.getByLabel('Full name').fill(u.name);
    await form.getByLabel('Email').fill(u.email);
    await form.getByLabel('Temporary password').fill(u.password);
    await form.getByLabel('Role', { exact: true }).selectOption(u.role);
    if (u.role === 'student') {
      await form.getByLabel('Admission no.').fill(u.admissionNo ?? '');
      if (u.className) await form.getByLabel('Class', { exact: true }).selectOption({ label: u.className });
      if (u.rollNo) await form.getByLabel('Roll no.').fill(String(u.rollNo));
    }
    await form.getByRole('button', { name: 'Create' }).click();
  }
  createFeedback(): Locator {
    return this.createCard().locator('.alert');
  }
  async filterBy(tab: 'all' | 'admin' | 'teacher' | 'student' | 'parent') {
    await this.page.getByRole('button', { name: tab, exact: true }).click();
  }
  row(email: string): Locator {
    return this.page.getByRole('row').filter({ hasText: email });
  }
  async deactivate(email: string) {
    await this.row(email).getByRole('button', { name: 'Deactivate' }).click();
  }
  async activate(email: string) {
    await this.row(email).getByRole('button', { name: 'Activate' }).click();
  }
  /** Reset password uses a native prompt(): the dialog handler must be registered before the click. */
  async resetPassword(email: string, newPassword: string) {
    this.page.once('dialog', (d) => d.accept(newPassword));
    await this.row(email).getByRole('button', { name: 'Reset password' }).click();
  }
  async delete(email: string) {
    this.page.once('dialog', (d) => d.accept());
    await this.row(email).getByRole('button', { name: 'Delete' }).click();
  }
  async openParentLinks(email: string) {
    await this.row(email).getByRole('button', { name: 'Parents' }).click();
  }
  linkCard(): Locator {
    return card(this.page, /^Parents of /);
  }
  async linkParent(parentName: string) {
    await this.linkCard().getByRole('checkbox', { name: new RegExp(parentName) }).check();
  }
  async saveLinks() {
    await this.linkCard().getByRole('button', { name: 'Save links' }).click();
  }
}
