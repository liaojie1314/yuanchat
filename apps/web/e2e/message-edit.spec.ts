/**
 * 消息编辑 E2E（mock 模式）
 *
 * @description
 * 覆盖气泡右键菜单的「编辑」入口闸门（自己的文本才有）、编辑态在底部输入区的表现
 * （提示条 / 原文填入 / 回车与发送按钮两条保存入口 / 取消与 Esc 退出），
 * 以及「已编辑」角标点开的编辑历史弹层。
 *
 * 前提：MSW mock 提供 `PATCH /messages/:id` 与 `GET /messages/:id/edits`；
 * demo 数据（mocks/demoData.ts）里「产品研发群」自带自己发的文本、对方的文本与图片，
 * 以及一条 `edited: true` + `editCount: 2` 的样本消息（角标可点的前置条件）。
 * locale 固定 zh-CN（见 playwright.config.ts），故断言用中文文案。
 *
 * @remarks 刻意不覆盖两类路径：
 *   1. 保存成功后气泡正文翻新 —— 前端不做乐观翻转，正文由服务端 `message.edited` 帧
 *      驱动 applyEdited，mock 模式没有 WS 帧回放，该路径由 shared 包单测 + 真后端手测覆盖；
 *   2. 4032/4033/4004 错误提示 —— mock 只在带 `?error=` 查询串时返错，而 UI 发出的
 *      请求不带该参数，E2E 无从触发；分支由 ChatWindow 的 code 分派 + 单测覆盖。
 */
import { test, expect, type Page } from "@playwright/test";
import { setAuth } from "./fixtures/auth.fixture";
import { waitForMSW } from "./utils/msw";

/** 历史 mock 里 version 1 那行的 editedAt（即「该版本被替换掉的时刻」），首版不该显示它 */
const V1_REPLACED_AT = "2026-09-05T09:58:00.000Z";

/** 打开 demo 的「产品研发群」，等消息流渲染出自己发的文本气泡 */
async function openFirstConversation(page: Page) {
  await page.goto("/chat");
  await page.getByRole("button", { name: /产品研发群/ }).click();
  await expect(page.locator('[data-kind="text"][data-self="true"]').first()).toBeVisible();
}

/** 右键第一条自己发的文本消息，返回其气泡定位器 */
async function openMenuOnOwnText(page: Page) {
  const bubble = page.locator('[data-kind="text"][data-self="true"]').first();
  await bubble.click({ button: "right" });
  return bubble;
}

/** 进入编辑态并返回输入框定位器 */
async function enterEditing(page: Page) {
  await openMenuOnOwnText(page);
  await page.getByTestId("msg-menu-edit").click();
  await expect(page.getByTestId("composer-editing-hint")).toBeVisible();
  return page.locator("textarea").first();
}

/** 打开「已编辑」角标背后的编辑历史弹层 */
async function openEditHistory(page: Page) {
  await page.getByTestId("msg-edited-badge").first().click();
  const dialog = page.getByRole("dialog", { name: "编辑记录" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("消息编辑", () => {
  test.beforeEach(async ({ page }) => {
    await setAuth(page);
    await waitForMSW(page);
    await openFirstConversation(page);
  });

  test("自己的文本消息菜单里有编辑项", async ({ page }) => {
    await openMenuOnOwnText(page);
    await expect(page.getByTestId("msg-menu-edit")).toBeVisible();
  });

  test("点编辑进入编辑态，原文填入输入框", async ({ page }) => {
    const bubble = page.locator('[data-kind="text"][data-self="true"]').first();
    const original = (await bubble.innerText()).trim();

    const input = await enterEditing(page);
    await expect(input).toHaveValue(original);
  });

  test("编辑态回车保存：退出编辑态且不发出新消息", async ({ page }) => {
    const textBubbles = page.locator('[data-kind="text"]');
    const before = await textBubbles.count();

    const input = await enterEditing(page);
    await input.fill("回车保存的正文");
    await input.press("Enter");

    // 回车若漏接编辑态就会走 onSend，消息流凭空多出一条
    await expect(page.getByTestId("composer-editing-hint")).toBeHidden();
    await expect(input).toHaveValue("");
    await expect(textBubbles).toHaveCount(before);
  });

  test("编辑态发送按钮变「保存」并可提交", async ({ page }) => {
    const input = await enterEditing(page);
    await input.fill("按钮保存的正文");
    await page.getByRole("button", { name: "保存", exact: true }).click();

    await expect(page.getByTestId("composer-editing-hint")).toBeHidden();
    await expect(input).toHaveValue("");
  });

  test("取消编辑后提示条消失、输入框清空", async ({ page }) => {
    const input = await enterEditing(page);
    await page.getByTestId("composer-cancel-edit").click();

    await expect(page.getByTestId("composer-editing-hint")).toBeHidden();
    await expect(input).toHaveValue("");
  });

  test("编辑态 Esc 退出", async ({ page }) => {
    const input = await enterEditing(page);
    await input.press("Escape");

    await expect(page.getByTestId("composer-editing-hint")).toBeHidden();
    await expect(input).toHaveValue("");
  });

  test("对方的消息菜单里没有编辑项", async ({ page }) => {
    await page.locator('[data-kind="text"][data-self="false"]').first().click({ button: "right" });
    // 菜单本身要弹出来（复制/引用仍在），只是不含编辑项
    await expect(page.getByRole("menu")).toBeVisible();
    await expect(page.getByTestId("msg-menu-edit")).toHaveCount(0);
  });

  test("图片消息菜单里没有编辑项", async ({ page }) => {
    await page.locator('[data-kind="image"]').first().click({ button: "right" });
    await expect(page.getByRole("menu")).toBeVisible();
    await expect(page.getByTestId("msg-menu-edit")).toHaveCount(0);
  });

  test("点已编辑角标打开历史弹层，列出各版本与当前版本标注", async ({ page }) => {
    const dialog = await openEditHistory(page);

    await expect(dialog.getByTestId("edit-history-current")).toBeVisible();
    await expect(dialog.getByText("最初发出的版本")).toBeVisible();
    // 「当前版本」既是 mock 里 version 3 的正文、又是当前版标签，会命中两处，故不按文本断言
    // 首版时间取消息自身的发送时间；拿该行 editedAt 会显示成它被替换掉的时刻
    await expect(dialog.getByTestId("edit-history-time-1")).not.toHaveAttribute(
      "datetime",
      V1_REPLACED_AT,
    );
  });

  test("历史弹层 Esc 可关闭", async ({ page }) => {
    const dialog = await openEditHistory(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});
