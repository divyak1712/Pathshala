import { Locator, Page } from '@playwright/test';

export class ProfilePage {
  constructor(private page: Page) {}
  async goto() {
    await this.page.goto('/profile');
  }
  async changePassword(current: string, next: string) {
    await this.page.getByLabel('Current password').fill(current);
    await this.page.getByLabel('New password').fill(next);
    await this.page.getByRole('button', { name: 'Update password' }).click();
  }
  updated(): Locator {
    return this.page.getByText('Password updated');
  }
  error(): Locator {
    return this.page.getByRole('alert');
  }
}
