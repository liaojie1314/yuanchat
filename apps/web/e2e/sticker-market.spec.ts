/**
 * 表情商城 E2E 测试
 *
 * @description
 * 全程跑在仓库既有的 mock 模式（MSW + demo 数据）下：
 * MSW 预置官方包 + 24 个演示包（默认页大小 20 之下必然有下一页），
 * 发布/上传/举报均有假档，不依赖真实后端。
 *
 * 覆盖：商城可达与列表渲染、游标分页「加载更多」、列表→详情跳转与返回、
 * 添加/已添加幂等切换、我发布的（空态 + 发布后出现）、发布表单校验与
 * 端到端发布（收藏来源 + 封面复制上传）。
 *
 * @remarks MSW 的商城状态随页面重载复位——涉及「发布后可见」的断言必须
 * 用应用内路由（点击链接/按钮）串联，不能用 page.goto（会整页刷新清空状态）。
 */
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { setAuth } from "./fixtures/auth.fixture";
import { waitForMSW } from "./utils/msw";

/** locale 固定为 zh-CN（见 playwright.config.ts），故直接用中文文案定位。 */
const TXT = {
  marketTitle: "表情商城",
  myPacks: "我发布的",
  publishBtn: "发布表情包",
  add: "添加",
  added: "已添加",
  loadMore: "加载更多",
  back: "返回",
  nameLabel: "表情包名称",
  submitPublish: "发布",
  goPublish: "去发布",
  deletePack: "删除表情包",
};

/** 打开商城列表页。 */
async function openMarket(page: Page) {
  await page.goto("/stickers");
  await waitForMSW(page);
  await expect(page).toHaveURL(/\/stickers/);
}

/** 发布一个收藏来源的包并停在详情页（SPA 流程，供后续用例复用状态）。 */
async function publishPack(page: Page, name: string) {
  await page.goto("/stickers/publish");
  await waitForMSW(page);
  // mock 预置 2 张收藏贴纸，勾选第一张（按钮可达名为「添加到表情」）
  const stickerButtons = page.getByRole("button", { name: "添加到表情" });
  await expect(stickerButtons).toHaveCount(2);
  await stickerButtons.first().click();
  await page.getByLabel(TXT.nameLabel).fill(name);
  await page.getByRole("button", { name: TXT.submitPublish }).click();
  // 发布成功跳转到新包详情（mock 生成 pack_<uuid> 形态的 id）
  await expect(page).toHaveURL(/\/stickers\/pack_[0-9a-f-]{36}$/, { timeout: 15000 });
}

test.describe("表情商城", () => {
  test.beforeEach(async ({ page }) => {
    await setAuth(page);
    await waitForMSW(page);
  });

  test("商城页可达，页头提供发布与我发布的入口", async ({ page }) => {
    await openMarket(page);
    await expect(page.getByRole("heading", { name: TXT.marketTitle })).toBeVisible();
    await expect(page.getByRole("button", { name: TXT.myPacks })).toBeVisible();
    await expect(page.getByRole("button", { name: TXT.publishBtn })).toBeVisible();
  });

  test("商城列出 mock 表情包卡片（含名称与发布者）", async ({ page }) => {
    await openMarket(page);
    // 预置 25 个包（24 演示 + 官方），第一页 20 个卡片
    const cards = page.locator("a[href^='/stickers/']");
    await expect(cards).toHaveCount(20, { timeout: 10000 });
    await expect(page.getByText("演示表情包 1").first()).toBeVisible();
    await expect(page.getByText("由 阿明 发布").first()).toBeVisible();
  });

  test("游标分页：点击加载更多追加下一页并收敛", async ({ page }) => {
    await openMarket(page);
    await expect(page.getByRole("button", { name: TXT.loadMore })).toBeVisible();
    await page.getByRole("button", { name: TXT.loadMore }).click();
    // 25 个包全部加载完后按钮消失
    await expect(page.getByRole("button", { name: TXT.loadMore })).toBeHidden({ timeout: 10000 });
    await expect(page.locator("a[href^='/stickers/']")).toHaveCount(25);
  });

  test("卡片进入详情，返回按钮回到商城列表", async ({ page }) => {
    await openMarket(page);
    await page.locator("a[href^='/stickers/']").first().click();
    await expect(page).toHaveURL(/\/stickers\/pack_/);
    await expect(page.getByRole("button", { name: TXT.back })).toBeVisible();
    await expect(
      page.getByRole("button", { name: TXT.add }).or(page.getByRole("button", { name: TXT.added })),
    ).toBeVisible();

    await page.getByRole("button", { name: TXT.back }).click();
    await expect(page).toHaveURL(/\/stickers$/);
  });

  test("添加/已添加幂等切换", async ({ page }) => {
    await openMarket(page);
    await page.locator("a[href^='/stickers/']").first().click();

    const addBtn = page.getByRole("button", { name: TXT.add });
    await expect(addBtn).toBeVisible();
    await addBtn.click();
    await expect(page.getByRole("button", { name: TXT.added })).toBeVisible();

    // 再点一次 = 移除，回到未添加态
    await page.getByRole("button", { name: TXT.added }).click();
    await expect(page.getByRole("button", { name: TXT.add })).toBeVisible();
  });

  test("我发布的初始为空，可从空态直达发布页", async ({ page }) => {
    await openMarket(page);
    await page.getByRole("button", { name: TXT.myPacks }).click();
    await expect(page).toHaveURL(/\/stickers\/mine/);
    await expect(page.getByText(/你还没有发布过表情包/)).toBeVisible();

    await page.getByRole("button", { name: TXT.goPublish }).click();
    await expect(page).toHaveURL(/\/stickers\/publish/);
  });

  test("发布页：表单校验拦截空提交", async ({ page }) => {
    await page.goto("/stickers/publish");
    await waitForMSW(page);

    await page.getByRole("button", { name: TXT.submitPublish }).click();
    await expect(page.getByText("请输入表情包名称")).toBeVisible();

    await page.getByLabel(TXT.nameLabel).fill("E2E 测试包");
    await page.getByRole("button", { name: TXT.submitPublish }).click();
    await expect(page.getByText("至少选择一张贴纸")).toBeVisible();
  });

  test("发布闭环：勾选收藏 → 命名 → 发布 → 经商城进入我发布的可见", async ({ page }) => {
    await publishPack(page, "E2E 发布包");

    // 详情页应展示新包名（页头与概要各一个标题，发布者本人不显示添加按钮）
    await expect(page.getByRole("heading", { name: "E2E 发布包" }).first()).toBeVisible();

    // 经桌面侧栏回商城（SPA 导航不重置 mock 状态），再进「我发布的」
    await page.getByRole("link", { name: TXT.marketTitle }).click();
    await page.getByRole("button", { name: TXT.myPacks }).click();
    await expect(page).toHaveURL(/\/stickers\/mine/);
    await expect(page.getByText("E2E 发布包")).toBeVisible();
  });

  test("我发布的可删除自己的包（二次确认）", async ({ page }) => {
    await publishPack(page, "待删除包");

    await page.getByRole("link", { name: TXT.marketTitle }).click();
    await page.getByRole("button", { name: TXT.myPacks }).click();
    await expect(page.getByText("待删除包")).toBeVisible();

    await page.getByRole("button", { name: TXT.deletePack }).first().click();
    // 确认弹窗里的删除按钮（common.delete）
    await page.getByRole("button", { name: "删除", exact: true }).click();
    await expect(page.getByText("待删除包")).toBeHidden();
  });
});
