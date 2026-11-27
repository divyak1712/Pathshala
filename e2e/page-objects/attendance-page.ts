import { Locator, Page } from '@playwright/test';

/** Teacher/admin class register. */
export class AttendanceRegisterPage {
  constructor(private page: Page) {}
  async goto() {
    await this.page.goto('/attendance');
  }
  async selectClass(label: string) {
    await this.page.getByLabel('Class').selectOption({ label });
  }
  async setDate(isoDate: string) {
    await this.page.getByLabel('Date').fill(isoDate);
  }
  row(studentName: string): Locator {
    return this.page.getByRole('row').filter({ hasText: studentName });
  }
  async mark(studentName: string, status: 'present' | 'absent' | 'late' | 'excused') {
    await this.row(studentName).getByRole('radio', { name: status }).check();
  }
  async markAllPresent() {
    await this.page.getByRole('button', { name: 'Mark all present' }).click();
  }
  async save() {
    await this.page.getByRole('button', { name: 'Save attendance' }).click();
  }
  saved(): Locator {
    return this.page.getByText('Attendance saved');
  }
  async statusOf(studentName: string): Promise<string | null> {
    for (const s of ['present', 'absent', 'late', 'excused']) {
      if (await this.row(studentName).getByRole('radio', { name: s }).isChecked()) return s;
    }
    return null;
  }
}

/** Student/parent attendance history. */
export class AttendanceHistoryPage {
  constructor(private page: Page) {}
  async goto() {
    await this.page.goto('/attendance');
  }
  stat(label: string): Locator {
    return this.page.locator('.stat').filter({ has: this.page.getByText(label, { exact: true }) }).locator('.stat-value');
  }
  historyRows(): Locator {
    return this.page.getByRole('row').filter({ has: this.page.locator('.badge') });
  }
}
