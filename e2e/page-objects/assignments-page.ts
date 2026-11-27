import { Locator, Page } from '@playwright/test';
import { card } from './shell';

export class TeacherAssignmentsPage {
  constructor(private page: Page) {}
  async goto() {
    await this.page.goto('/assignments');
  }
  async post(a: { subjectLabel: string | RegExp; title: string; maxMarks?: number; dueDate?: string; instructions?: string }) {
    const c = card(this.page, 'Post an assignment');
    const select = c.getByLabel('Class & subject');
    const label = await select.locator('option', { hasText: a.subjectLabel }).first().innerText();
    await select.selectOption({ label });
    await c.getByLabel('Title').fill(a.title);
    if (a.dueDate) await c.getByLabel('Due').fill(a.dueDate);
    if (a.maxMarks) await c.getByLabel('Max marks').fill(String(a.maxMarks));
    if (a.instructions) await c.getByLabel('Instructions').fill(a.instructions);
    await c.getByRole('button', { name: 'Post' }).click();
  }
  posted(): Locator {
    return this.page.getByText('Assignment posted');
  }
  row(title: string): Locator {
    return card(this.page, 'Posted assignments').getByRole('row').filter({ hasText: title });
  }
  async openSubmissions(title: string) {
    await this.row(title).getByRole('button', { name: 'Submissions' }).click();
  }
  /** One block per student inside the "Submissions" card. */
  submission(studentName: string): Locator {
    return card(this.page, /^Submissions/).locator('.card').filter({ hasText: studentName });
  }
  async grade(studentName: string, marks: number, feedback?: string) {
    const block = this.submission(studentName);
    await block.getByLabel('Marks').fill(String(marks));
    if (feedback) await block.getByLabel('Feedback').fill(feedback);
    await block.getByRole('button', { name: 'Save grade' }).click();
  }
  graded(): Locator {
    return this.page.getByText('Graded', { exact: true });
  }
}

export class StudentAssignmentsPage {
  constructor(private page: Page) {}
  async goto() {
    await this.page.goto('/assignments');
  }
  item(title: string): Locator {
    return this.page.locator('section.card').filter({ has: this.page.getByRole('heading', { level: 2, name: title }) });
  }
  async submit(title: string, answer: string) {
    const item = this.item(title);
    await item.getByLabel(`Your answer for ${title}`).fill(answer);
    await item.getByRole('button', { name: /^(Submit|Resubmit)$/ }).click();
  }
  submitted(): Locator {
    return this.page.getByText('Submitted', { exact: true });
  }
}
