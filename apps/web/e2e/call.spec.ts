/**
 * 语音与视频通话 E2E（mock 模式）
 *
 * @description
 * 覆盖从「点通话按钮」到「呼出界面出现 / 挂断后消失」这段**不依赖对端**的路径：
 * 单聊直接发起、群聊先选人（mesh 上限 4 人 = 自己 + 3）、以及挂断出画。
 *
 * 前提：
 * - Chromium 需 `--use-fake-device-for-media-stream` 等启动参数，否则 headless 下
 *   `getUserMedia` 直接拒绝，`startCall` 在取媒体这一步就返回，呼出界面永远不出现；
 * - MSW mock 提供 `GET /conversations/:id/members`（选人弹窗的数据源）与
 *   `GET /calls/ice-servers`；demo 数据里「产品研发群」= 群聊、「张伟」= 单聊。
 * - locale 固定 zh-CN（见 playwright.config.ts），故断言用中文文案。
 *
 * @remarks 刻意不覆盖：接通后的 mesh 协商、远端画面、通话记录气泡。
 *   它们都要求**两个真实端同时在线**，mock 模式没有 WS 帧回放，
 *   由 shared 包单测（callStore / peerMesh）+ 双端真机实测覆盖。
 */
import { test, expect, type Page } from "@playwright/test";
import { setAuth } from "./fixtures/auth.fixture";
import { waitForMSW } from "./utils/msw";

// 假摄像头/麦克风：没有这组参数，headless Chromium 的 getUserMedia 恒失败
test.use({
  launchOptions: {
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  },
  permissions: ["microphone", "camera"],
});

/** 打开指定会话（按会话列表里的名字点） */
async function openConversation(page: Page, name: string | RegExp) {
  await page.goto("/chat");
  await page.getByRole("button", { name }).first().click();
}

/** 顶栏的语音/视频通话按钮（`hidden sm:grid`，桌面视口下可见） */
function callButton(page: Page, media: "audio" | "video") {
  return page.getByRole("button", { name: media === "video" ? "视频通话" : "语音通话" }).first();
}

/** 通话浮层（呼出/来电/通话中同一个 dialog） */
function callOverlay(page: Page) {
  return page.getByRole("dialog", { name: "语音通话" });
}

test.describe("语音与视频通话", () => {
  test.beforeEach(async ({ page }) => {
    await setAuth(page);
    await waitForMSW(page);
  });

  test("单聊点语音通话 → 出现呼出界面，挂断后出画", async ({ page }) => {
    await openConversation(page, /张伟/);

    await callButton(page, "audio").click();

    const overlay = callOverlay(page);
    await expect(overlay).toBeVisible();
    // 呼出态：只有挂断，没有接听/拒接（那是来电态的按钮）
    await expect(overlay.getByRole("button", { name: "挂断" })).toBeVisible();
    await expect(overlay.getByRole("button", { name: "接听" })).toHaveCount(0);

    await overlay.getByRole("button", { name: "挂断" }).click();
    // 本端立即出画，不等服务端 call.ended —— 挂断后还留着界面像是没挂掉
    await expect(overlay).toHaveCount(0);
  });

  test("单聊视频通话的呼出界面带摄像头开关", async ({ page }) => {
    await openConversation(page, /张伟/);

    await callButton(page, "video").click();

    const overlay = callOverlay(page);
    await expect(overlay).toBeVisible();
    await expect(overlay.getByRole("button", { name: "关闭摄像头" })).toBeVisible();
  });

  test("群聊点通话先开选人弹窗，未选人时发起按钮禁用", async ({ page }) => {
    await openConversation(page, /产品研发群/);

    await callButton(page, "audio").click();

    const modal = page.getByRole("dialog", { name: "选择通话成员" });
    await expect(modal).toBeVisible();
    // 群通话必须先选人：mesh 上限 4 人，默认全群会在大群里必然失败一半
    await expect(callOverlay(page)).toHaveCount(0);
    await expect(modal.getByRole("button", { name: "语音通话" })).toBeDisabled();
  });

  test("选人弹窗选满 3 人后第 4 人点不动，确认后进入呼出界面", async ({ page }) => {
    await openConversation(page, /产品研发群/);
    await callButton(page, "audio").click();

    const modal = page.getByRole("dialog", { name: "选择通话成员" });
    // 自己（E2E Tester）被剔除，剩 4 个候选
    const candidates = modal.locator("button[aria-pressed]");
    await expect(candidates).toHaveCount(4);

    for (let i = 0; i < 3; i++) await candidates.nth(i).click();
    await expect(candidates.nth(0)).toHaveAttribute("aria-pressed", "true");
    // 选满即封顶：第 4 个禁用而不是静静地无响应
    await expect(candidates.nth(3)).toBeDisabled();
    await expect(candidates.nth(3)).toHaveAttribute("aria-pressed", "false");

    await modal.getByRole("button", { name: "语音通话" }).click();
    await expect(modal).toHaveCount(0);
    await expect(callOverlay(page)).toBeVisible();
  });
});
