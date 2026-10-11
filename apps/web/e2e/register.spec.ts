/**
 * 注册流程 E2E 测试
 *
 * @description
 * 覆盖：成功注册、表单校验错误（昵称/邮箱/验证码/密码）、
 * 发码后的 60 秒冷却与按钮禁用、Enter 快捷键。
 * 使用 MSW mock API，mock 只接受验证码 123456。
 */

import { test, expect } from "@playwright/test";
import { RegisterPage } from "./pages/RegisterPage";
import { waitForMSW } from "./utils/msw";
import { clearAuth } from "./fixtures/auth.fixture";

/** mock 侧唯一被接受的验证码 */
const OTP = "123456";

test.describe("Register Flow", () => {
  let registerPage: RegisterPage;

  test.beforeEach(async ({ page }) => {
    // clearAuth 已经在 /login 页面，需要导航到 /register
    await clearAuth(page);
    await waitForMSW(page);
    registerPage = new RegisterPage(page);
    await registerPage.goto();
  });

  test("successful registration redirects to /chat", async ({ page }) => {
    await registerPage.register("新用户", "new@yuanchat.com", OTP, "Abc1234!");
    await page.waitForURL("**/chat", { timeout: 10000 });
    expect(page.url()).toContain("/chat");
  });

  test("shows error for empty nickname", async ({ page }) => {
    await registerPage.registerButton.click();
    await expect(page.getByText("请输入昵称")).toBeVisible();
  });

  test("shows error for invalid email", async ({ page }) => {
    await registerPage.nicknameInput.fill("新用户");
    await registerPage.emailInput.fill("not-an-email");
    await registerPage.registerButton.click();
    await expect(page.getByText("邮箱格式不正确")).toBeVisible();
  });

  test("shows error for empty verification code", async ({ page }) => {
    await registerPage.nicknameInput.fill("新用户");
    await registerPage.emailInput.fill("new@yuanchat.com");
    await registerPage.passwordInput.fill("Abc1234!");
    await registerPage.registerButton.click();
    await expect(page.getByText("请输入 6 位验证码")).toBeVisible();
  });

  test("shows error for weak password", async ({ page }) => {
    await registerPage.nicknameInput.fill("新用户");
    await registerPage.emailInput.fill("new@yuanchat.com");
    await registerPage.codeInput.fill(OTP);
    await registerPage.passwordInput.fill("short");
    await registerPage.registerButton.click();
    await expect(page.getByText("密码长度至少 8 位")).toBeVisible();
  });

  test("no phone field on the form at all", async ({ page }) => {
    // 注册只收邮箱：手机号输入框整条移除，留着 placeholder 残留就是契约漂了
    await expect(page.getByPlaceholder(/手机号/)).toHaveCount(0);
    await expect(page.locator('input[type="tel"]')).toHaveCount(0);
  });

  test("send code requires a valid email first", async ({ page }) => {
    await registerPage.sendCodeButton.click();
    await expect(page.getByText("请输入邮箱")).toBeVisible();
  });

  test("sending a code starts the 60s cooldown and disables the button", async () => {
    await registerPage.sendCode("new@yuanchat.com");
    // 发码成功后提示语换成「已发送至 …」，按钮进入倒计时且不可再点
    await expect(registerPage.page.getByText(/验证码已发送至 new@yuanchat\.com/)).toBeVisible({
      timeout: 5000,
    });
    await expect(registerPage.sendCodeButton).toBeDisabled();
    await expect(registerPage.sendCodeButton).toHaveText(/重新发送（\d+s）/);
  });

  test("cooldown response surfaces the i18n error instead of a bare message", async ({ page }) => {
    // mock 里这个邮箱固定回 429 auth.otpCooldown
    await registerPage.sendCode("cooldown@yuanchat.com");
    await expect(page.getByText("发送过于频繁，请稍后再试")).toBeVisible({ timeout: 5000 });
  });

  test("Enter key on the code field triggers registration", async ({ page }) => {
    await registerPage.nicknameInput.fill("新用户");
    await registerPage.emailInput.fill("new@yuanchat.com");
    await registerPage.passwordInput.fill("Abc1234!");
    await registerPage.codeInput.fill(OTP);
    await registerPage.codeInput.press("Enter");
    await page.waitForURL("**/chat", { timeout: 10000 });
    expect(page.url()).toContain("/chat");
  });
});
