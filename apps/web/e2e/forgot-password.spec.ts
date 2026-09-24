/**
 * 忘记密码三段式改密 E2E 测试
 *
 * @description
 * 覆盖：三步走通到成功页、验证码错误后原地重输（不退回第 1 步）、
 * 未注册手机号与已注册不可区分（同样进入第 2 步）。
 * 使用 MSW mock API（VITE_ENABLE_MOCK=true），无需真实后端。
 *
 * MSW 侧约定：唯一被接受的验证码是 123456，其余一律回 auth.otpWrong 且不消耗验证码。
 */

import { test, expect } from "@playwright/test";
import { waitForMSW } from "./utils/msw";
import { clearAuth } from "./fixtures/auth.fixture";

const VALID_CODE = "123456";
const NEW_PASSWORD = "Abcdef12";

test.describe("忘记密码", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await waitForMSW(page);
    await page.goto("/forgot-password");
  });

  test("三步走通后显示重置成功", async ({ page }) => {
    await page.getByPlaceholder("手机号").fill("13800000001");
    await page.getByRole("button", { name: "发送验证码" }).click();

    await page.getByPlaceholder("6 位验证码").fill(VALID_CODE);
    await page.getByRole("button", { name: "下一步" }).click();

    await page.getByPlaceholder("新密码", { exact: true }).fill(NEW_PASSWORD);
    await page.getByPlaceholder("确认新密码").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "确认修改" }).click();

    await expect(page.getByText("密码重置成功")).toBeVisible();
  });

  test("验证码错误后留在第 2 步且验证码输入框仍可用", async ({ page }) => {
    await page.getByPlaceholder("手机号").fill("13800000001");
    await page.getByRole("button", { name: "发送验证码" }).click();

    const codeInput = page.getByPlaceholder("6 位验证码");
    await codeInput.fill("000000");
    await page.getByRole("button", { name: "下一步" }).click();

    // 服务端不消耗验证码，因此必须留在第 2 步重输，而不是被退回第 1 步重新发码
    await expect(page.getByText("验证码错误，请重试")).toBeVisible();
    await expect(codeInput).toBeVisible();
    await expect(page.getByRole("button", { name: "发送验证码" })).toHaveCount(0);

    // 原地改成正确验证码即可继续
    await codeInput.fill(VALID_CODE);
    await page.getByRole("button", { name: "下一步" }).click();
    await expect(page.getByPlaceholder("确认新密码")).toBeVisible();
  });

  test("未注册手机号与已注册的表现完全一致", async ({ page }) => {
    // 服务端对未注册号同样返回 204 空体，前端不得据此提示「该号未注册」，
    // 否则等于提供用户枚举接口
    await page.getByPlaceholder("手机号").fill("19900000000");
    await page.getByRole("button", { name: "发送验证码" }).click();

    await expect(page.getByPlaceholder("6 位验证码")).toBeVisible();
    await expect(page.getByText(/未注册|不存在|not registered/i)).toHaveCount(0);
  });
});
