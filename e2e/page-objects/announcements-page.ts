import { Locator, Page } from '@playwright/test';
import { card } from './shell';

export class AnnouncementsPage {
  constructor(private page: Page) {}
  async goto() {
    await this.page.goto('/announcements');
  }
  async publish(a: { title: string; message: string; audience?: string; classLabel?: string }) {
    const c = card(this.page, 'New announcement');
    if (a.audience) await c.getByLabel('Audience').selectOption({ label: a.audience });
    if (a.classLabel) await c.getByLabel(/^Class/).selectOption({ label: a.classLabel });
    await c.getByLabel('Title').fill(a.title);
    await c.getByLabel('Message').fill(a.message);
    await c.getByRole('button', { name: 'Publish' }).click();
  }
  published(): Locator {
    return this.page.getByText('Announcement published');
  }
  error(): Locator {
    return this.page.getByRole('alert');
  }
  item(title: string): Locator {
    return this.page.locator('section.card').filter({ has: this.page.getByRole('heading', { level: 2, name: title }) });
  }
  async delete(title: string) {
    this.page.once('dialog', (d) => d.accept());
    await this.item(title).getByRole('button', { name: 'Delete' }).click();
  }
  canPost(): Locator {
    return this.page.getByRole('heading', { level: 2, name: 'New announcement' });
  }
}
