import { expect, Locator, Page } from '@playwright/test';
import { Person } from '../helpers/api';

export class LoginPage {
  constructor(private page: Page) {}
  async goto() {
    await this.page.goto('/login');
  }
  async signIn(email: string, password: string) {
    await this.page.getByLabel('Email').fill(email);
    await this.page.getByLabel('Password').fill(password);
    await this.page.getByRole('button', { name: 'Sign in' }).click();
  }
  /** Full journey: open the login page and sign in; waits until the app shell is visible. */
  async loginAs(user: Pick<Person, 'email' | 'password' | 'name'>) {
    await this.goto();
    await this.signIn(user.email, user.password);
    await expect(this.page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  }
  error(): Locator {
    return this.page.getByRole('alert');
  }
}

/** The signed-in frame: sidebar, top bar, child switcher. */
export class Shell {
  constructor(private page: Page) {}
  nav(): Locator {
    return this.page.getByRole('navigation', { name: 'Main' });
  }
  navLink(name: string): Locator {
    return this.nav().getByRole('link', { name, exact: true });
  }
  async navigate(name: string) {
    await this.navLink(name).click();
  }
  async navLabels(): Promise<string[]> {
    return (await this.nav().getByRole('link').allInnerTexts()).map((t) => t.trim());
  }
  /** The account link in the top bar (shows the user's name and role badge). */
  userLink(name: string): Locator {
    return this.page.getByRole('link', { name });
  }
  async signOut() {
    await this.page.getByRole('button', { name: 'Sign out' }).click();
    await expect(this.page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  }
  heading(name: string | RegExp): Locator {
    return this.page.getByRole('heading', { level: 1, name });
  }
  childSwitcher(): Locator {
    return this.page.getByLabel('Viewing child');
  }
  async chooseChild(name: string) {
    const value = await this.childSwitcher().locator('option', { hasText: name }).first().getAttribute('value');
    await this.childSwitcher().selectOption(value!);
  }
}

/** Reads a dashboard / summary stat tile by its label. */
export function statValue(page: Page, label: string | RegExp): Locator {
  return page.locator('.stat').filter({ hasText: label }).locator('.stat-value');
}

/** A bordered card identified by its h2 title. */
export function card(page: Page, title: string | RegExp): Locator {
  return page.locator('section.card').filter({ has: page.getByRole('heading', { level: 2, name: title }) });
}
