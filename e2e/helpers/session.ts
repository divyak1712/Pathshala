import { Browser, BrowserContext, Page } from '@playwright/test';
import { LoginPage, Shell } from '../page-objects/shell';
import { BASE_URL } from './constants';
import { Person } from './api';

/**
 * Several signed-in users in one test (e.g. teacher marks, student checks), each in an isolated browser context
 * so their cookies never mix. Call closeAll() in afterEach.
 */
export class Sessions {
  private contexts: BrowserContext[] = [];
  constructor(private browser: Browser) {}

  async open(user: Pick<Person, 'email' | 'password' | 'name'>): Promise<{ page: Page; shell: Shell }> {
    // Manually-created contexts do not inherit config `use` options, so pass what the pages rely on.
    const context = await this.browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 800 } });
    context.setDefaultTimeout(15_000);
    this.contexts.push(context);
    const page = await context.newPage();
    await new LoginPage(page).loginAs(user);
    return { page, shell: new Shell(page) };
  }

  /** A fresh, signed-out page (for testing failed logins). */
  async blank(): Promise<Page> {
    const context = await this.browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 800 } });
    context.setDefaultTimeout(15_000);
    this.contexts.push(context);
    return context.newPage();
  }

  async closeAll() {
    await Promise.all(this.contexts.splice(0).map((c) => c.close().catch(() => undefined)));
  }
}
