/**
 * 登录页 Page Object Model
 *
 * @description
 * 封装登录页的元素定位器和常用操作，
 * 使测试代码专注于业务逻辑而非 DOM 结构。
 */

import type { Page, Locator } from "@playwright/test";

export class LoginPage {
  readonly page: Page;
  readonly yuanchatIdInput: Locator;
  readonly passwordInput: Locator;
  readonly loginButton: Locator;
  readonly registerLink: Locator;

  constructor(page: Page) {
    this.page = page;
    this.yuanchatIdInput = page.getByPlaceholder("元聊号");
    this.passwordInput = page.getByPlaceholder("密码");
    this.loginButton = page.getByRole("button", { name: /登 录|登录中…/ });
    this.registerLink = page.getByRole("link", { name: "立即注册" });
  }

  /** 导航到登录页 */
  async goto(): Promise<void> {
    await this.page.goto("/login");
  }

  /** 填写表单并提交 */
  async login(id: string, password: string): Promise<void> {
    await this.yuanchatIdInput.fill(id);
    await this.passwordInput.fill(password);
    await this.loginButton.click();
  }
}
