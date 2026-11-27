import { Locator, Page } from '@playwright/test';
import { card } from './shell';

export class AcademicsPage {
  constructor(private page: Page) {}
  async goto() {
    await this.page.goto('/academics');
  }
  private classes() {
    return card(this.page, 'Classes');
  }
  private subjects() {
    return card(this.page, 'Subjects');
  }
  private assignments() {
    return card(this.page, /^Teaching assignments/);
  }

  async addClass(name: string, opts: { section?: string; year?: string; classTeacher?: string } = {}) {
    const c = this.classes();
    await c.getByLabel('Name').fill(name);
    if (opts.section) await c.getByLabel('Section').fill(opts.section);
    if (opts.year) await c.getByLabel('Year').fill(opts.year);
    if (opts.classTeacher) await c.getByLabel('Class teacher').selectOption({ label: opts.classTeacher });
    await c.getByRole('button', { name: 'Add' }).click();
  }
  classRow(name: string): Locator {
    return this.classes().getByRole('row').filter({ hasText: name });
  }
  async addSubject(name: string, code: string) {
    const c = this.subjects();
    await c.getByLabel('Name').fill(name);
    await c.getByLabel('Code').fill(code);
    await c.getByRole('button', { name: 'Add' }).click();
  }
  subjectRow(name: string): Locator {
    return this.subjects().getByRole('row').filter({ hasText: name });
  }
  async assignTeacher(className: string, subjectName: string, teacherName: string) {
    const c = this.assignments();
    await c.getByLabel('Class').selectOption({ label: className });
    await c.getByLabel('Subject').selectOption({ label: subjectName });
    await c.getByLabel('Teacher').selectOption({ label: teacherName });
    await c.getByRole('button', { name: 'Assign' }).click();
  }
  assignmentRow(subjectName: string): Locator {
    return this.assignments().getByRole('row').filter({ hasText: subjectName });
  }
  /** Delete uses a native confirm(). */
  async deleteClass(name: string) {
    this.page.once('dialog', (d) => d.accept());
    await this.classRow(name).getByRole('button', { name: 'Delete' }).click();
  }
  error(): Locator {
    return this.page.getByRole('alert');
  }
}
