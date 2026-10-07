/**
 * 注册页 Page Object Model
 *
 * @description
 * 封装注册页的元素定位器和常用操作。
 * 注册走邮箱验证码：邮箱 → 获取验证码（60 秒冷却）→ 填码 + 密码 + 昵称。
 */

import type { Page, Locator } from "@playwright/test";

export class RegisterPage {
  readonly page: Page;
  readonly nicknameInput: Locator;
  readonly emailInput: Locator;
  readonly codeInput: Locator;
  readonly sendCodeButton: Locator;
  readonly passwordInput: Locator;
  readonly phoneInput: Locator;
  readonly registerButton: Locator;
  readonly loginLink: Locator;

  constructor(page: Page) {
    this.page = page;
    // 文案来自 zh-CN 词条（playwright.config.ts 已把 locale 钉在 zh-CN）
    this.nicknameInput = page.getByPlaceholder("昵称");
    this.emailInput = page.getByPlaceholder("邮箱（用于接收验证码）");
    this.codeInput = page.getByPlaceholder("6 位验证码");
    this.passwordInput = page.getByPlaceholder("密码（至少 8 位）");
    this.phoneInput = page.getByPlaceholder("手机号（选填）");
    // 同一个按钮在三种态下换文案：未发送 / 冷却中 / 冷却结束
    this.sendCodeButton = page.getByRole("button", {
      name: /^(发送验证码|发送中…|重新发送(（\d+s）)?)$/,
    });
    // 两字按钮中间的排版空格属样式取舍，用 \s* 兼容有无空格两种写法；首尾锚定避免命中含「注册」的其他控件
    this.registerButton = page.getByRole("button", { name: /^(注\s*册|注册中…)$/ });
    this.loginLink = page.getByRole("link", { name: "立即登录" });
  }

  /** 导航到注册页 */
  async goto(): Promise<void> {
    await this.page.goto("/register");
  }

  /** 填邮箱并点「获取验证码」，返回时按钮已进入冷却 */
  async sendCode(email: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.sendCodeButton.click();
  }

  /** 填写必填字段并提交（手机号选填，不在这里填） */
  async register(nickname: string, email: string, code: string, password: string): Promise<void> {
    await this.nicknameInput.fill(nickname);
    await this.emailInput.fill(email);
    await this.codeInput.fill(code);
    await this.passwordInput.fill(password);
    await this.registerButton.click();
  }
}
