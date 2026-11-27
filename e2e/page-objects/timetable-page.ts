import { Locator, Page } from '@playwright/test';
import { card } from './shell';

export class TimetablePage {
  constructor(private page: Page) {}
  async goto() {
    await this.page.goto('/timetable');
  }
  async chooseClass(label: string) {
    await card(this.page, 'Add a period').getByLabel('Class').selectOption({ label });
  }
  async addPeriod(p: { subjectLabel: string | RegExp; day: string; start: string; end: string; room?: string }) {
    const c = card(this.page, 'Add a period');
    const select = c.getByLabel('Subject');
    const label = await select.locator('option', { hasText: p.subjectLabel }).first().innerText();
    await select.selectOption({ label });
    await c.getByLabel('Day').selectOption({ label: p.day });
    await c.getByLabel('Start').fill(p.start);
    await c.getByLabel('End').fill(p.end);
    if (p.room) await c.getByLabel('Room').fill(p.room);
    await c.getByRole('button', { name: 'Add period' }).click();
  }
  added(): Locator {
    return this.page.getByText('Period added');
  }
  error(): Locator {
    return this.page.getByRole('alert');
  }
  day(name: string): Locator {
    return this.page.locator('section.card').filter({ has: this.page.getByRole('heading', { level: 2, name, exact: true }) });
  }
  period(day: string, time: string): Locator {
    return this.day(day).getByRole('row').filter({ hasText: time });
  }
}
