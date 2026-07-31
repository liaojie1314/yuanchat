/**
 * 注册页 Page Object Model
 *
 * @description
 * 封装注册页的元素定位器和常用操作。
 */

import type { Page, Locator } from "@playwright/test";

export class RegisterPage {
  readonly page: Page;
  readonly nicknameInput: Locator;
  readonly phoneInput: Locator;
  readonly passwordInput: Locator;
  readonly captchaInput: Locator;
  readonly captchaButton: Locator;
  readonly captchaImage: Locator;
  readonly registerButton: Locator;
  readonly loginLink: Locator;

  constructor(page: Page) {
    this.page = page;
    this.nicknameInput = page.getByPlaceholder("昵称");
    this.phoneInput = page.getByPlaceholder("手机号");
    this.passwordInput = page.getByPlaceholder("密码（至少 8 位）");
    this.captchaInput = page.getByPlaceholder("验证码");
    this.captchaButton = page.locator("button[title='点击刷新验证码']");
    // 按钮内含两个 svg（验证码图片 + hover 时的 RefreshCw 图标），
    // 取第一个即验证码图片本身，避免 strict mode violation
    this.captchaImage = this.captchaButton.locator("svg").first();
    this.registerButton = page.getByRole("button", { name: /注 册|注册中…/ });
    this.loginLink = page.getByRole("link", { name: "立即登录" });
  }

  /** 导航到注册页 */
  async goto(): Promise<void> {
    await this.page.goto("/register");
  }

  /** 填写所有字段并提交 */
  async register(
    nickname: string,
    phone: string,
    password: string,
    captchaAnswer: string,
  ): Promise<void> {
    await this.nicknameInput.fill(nickname);
    await this.phoneInput.fill(phone);
    await this.passwordInput.fill(password);
    await this.captchaInput.fill(captchaAnswer);
    await this.registerButton.click();
  }
}
