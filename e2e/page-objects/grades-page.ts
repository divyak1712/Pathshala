import { Locator, Page } from '@playwright/test';
import { card } from './shell';

/** Teacher gradebook. */
export class GradebookPage {
  constructor(private page: Page) {}
  async goto() {
    await this.page.goto('/grades');
  }
  async selectSubject(label: string | RegExp) {
    const select = this.page.getByLabel('Class & subject');
    const text = await select.locator('option', { hasText: label }).first().innerText();
    await select.selectOption({ label: text });
  }
  async createAssessment(a: { title: string; type?: string; maxMarks: number; date?: string }) {
    const c = card(this.page, 'New assessment');
    await c.getByLabel('Title').fill(a.title);
    if (a.type) await c.getByLabel('Type').selectOption(a.type);
    await c.getByLabel('Max marks').fill(String(a.maxMarks));
    if (a.date) await c.getByLabel('Date').fill(a.date);
    await c.getByRole('button', { name: 'Create' }).click();
  }
  assessmentRow(title: string): Locator {
    return card(this.page, 'Assessments').getByRole('row').filter({ hasText: title });
  }
  async openMarks(title: string) {
    await this.assessmentRow(title).getByRole('button', { name: 'Enter marks' }).click();
  }
  async enterMarks(studentName: string, marks: number | string, remarks?: string) {
    await this.page.getByLabel(`Marks for ${studentName}`).fill(String(marks));
    if (remarks) await this.page.getByLabel(`Remarks for ${studentName}`).fill(remarks);
  }
  async saveMarks() {
    await this.page.getByRole('button', { name: 'Save marks' }).click();
  }
  saved(): Locator {
    return this.page.getByText('Marks saved');
  }
  error(): Locator {
    return this.page.getByRole('alert');
  }
}

/** Student/parent report card. */
export class ReportCardPage {
  constructor(private page: Page) {}
  async goto() {
    await this.page.goto('/grades');
  }
  subjectRow(subject: string): Locator {
    return card(this.page, 'Subject averages').getByRole('row').filter({ hasText: subject });
  }
  resultRow(title: string): Locator {
    return card(this.page, 'All results').getByRole('row').filter({ hasText: title });
  }
}
