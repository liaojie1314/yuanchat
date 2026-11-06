/**
 * 文件下载进度条 E2E — 真实布局测量
 *
 * @description
 * 按 MASTER_PLAN §2.12 的教训：宽度/溢出类断言一律量真实 getBoundingClientRect，
 * 不要只断言类名 —— JSDOM 不做布局，offsetWidth 恒为 0，气泡宽度那个 bug
 * 就是「单测全绿、真机照穿」三次。进度条挂在气泡外层、用 w-full 正推宽度，
 * 这里在窄屏长文件名与桌面短文件名下量宽度、消息高度和下条消息的坐标。
 *
 * 为什么挂起对象字节流：mock 的 /files/download-url 回 data URL，
 * 真实 fetch 几十毫秒就下完，进度条闪现即逝量不到。把 window.fetch 对
 * data: 的调用换成永不 resolve 的 Promise，进度条就停在不确定态供测量；
 * 其余请求照走原 fetch（→ MSW）。
 * 生命周期布局用真实 store 驱动，才能稳定停留在 saving 等短暂状态；
 * 只通过 Vite 源模块设置测试数据，不给生产代码挂测试入口。
 */
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { ChatMessage, DownloadEntry } from "../../../packages/shared/src";
import { setAuth } from "./fixtures/auth.fixture";
import { waitForMSW } from "./utils/msw";

/** 手机视口：进度条与气泡列在窄屏下才可能互相顶到（桌面 1920px 永远碰不上） */
test.use({ viewport: { width: 412, height: 915 } });

const downloadStoreUrl = `/@fs${new URL("../../../packages/shared/src/download/downloadStore.ts", import.meta.url).pathname}`;
const messageStoreUrl = `/@fs${new URL("../../../packages/shared/src/store/messageStore.ts", import.meta.url).pathname}`;

/** 驱动实际状态源；阶段切换后的 React 与虚拟列表测量仍在真实浏览器执行。 */
async function setProgress(page: Page, id: string, entry: DownloadEntry | null) {
  await page.evaluate(
    async ({ source, id, entry }) => {
      const { useDownloadStore } = await import(source);
      const entries = { ...useDownloadStore.getState().entries };
      if (entry) entries[id] = entry;
      else delete entries[id];
      useDownloadStore.setState({ entries });
    },
    { source: downloadStoreUrl, id, entry },
  );
}

async function openConversationWithFile(page: Page) {
  await page.goto("/chat");
  await page.getByText("产品研发群").first().click();
  const bubble = page.locator('[data-testid="file-bubble"]').first();
  await expect(bubble).toBeVisible();
  return bubble;
}

test.describe("文件下载进度条", () => {
  test.beforeEach(async ({ page }) => {
    await setAuth(page);
    await waitForMSW(page);
  });

  test("进度条不超出气泡所在列的宽度", async ({ page }) => {
    const bubble = await openConversationWithFile(page);

    // 截下对象字节流：MSW 签出的 data URL 由挂起的假 fetch 接管，
    // 其余请求照走原 fetch。必须在点下载之前装好
    await page.evaluate(() => {
      const original = window.fetch.bind(window);
      window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith("data:")) return new Promise<Response>(() => {});
        return original(input as RequestInfo, init);
      };
    });

    // 文件气泡的下载按钮（aria-label 走 zh-CN：下载）
    await bubble.getByRole("button", { name: "下载" }).click();

    const bar = page.getByRole("progressbar").first();
    await expect(bar).toBeVisible();

    const barBox = await bar.boundingBox();
    // 气泡的父级是「气泡行」（w-full，宽 = 75% 列宽），进度条与其同级同宽
    const colBox = await bubble.locator("xpath=..").boundingBox();
    expect(barBox).not.toBeNull();
    expect(colBox).not.toBeNull();
    expect(barBox!.width).toBeGreaterThan(0);
    expect(barBox!.width).toBeLessThanOrEqual(colBox!.width + 1);
  });

  for (const sample of [
    {
      width: 412,
      name: `${"发布评审归档与跨平台兼容性检查".repeat(8)}.pdf`,
      label: "窄屏长文件名",
    },
    { width: 1440, name: "a.pdf", label: "桌面短文件名" },
  ]) {
    test(`${sample.label}：下载全生命周期不改变消息高度或推挤下条消息`, async ({ page }) => {
      await page.setViewportSize({ width: sample.width, height: 915 });
      const bubble = await openConversationWithFile(page);
      const row = bubble.locator("xpath=ancestor::*[@data-msg-id][1]");
      const id = await row.getAttribute("data-msg-id");
      expect(id).toBeTruthy();
      await page.evaluate(
        async ({ source, id, name }) => {
          const { useMessageStore } = await import(source);
          const all = useMessageStore.getState().messagesByConv as Record<string, ChatMessage[]>;
          const target = Object.entries(all).find(([, messages]) =>
            messages.some((m) => m.id === id),
          );
          if (!target) throw new Error("file message fixture was not loaded");
          const [conversationId, messages] = target;
          useMessageStore.setState({
            messagesByConv: {
              ...all,
              [conversationId]: messages.map((message) =>
                message.id === id && message.file
                  ? { ...message, file: { ...message.file, name } }
                  : message,
              ),
            },
          });
        },
        { source: messageStoreUrl, id, name: sample.name },
      );
      await expect(bubble).toContainText(sample.name);
      await setProgress(page, id!, null);

      const column = bubble.locator("xpath=../..");
      const slot = column.getByTestId("file-progress-slot");
      const next = row.locator("xpath=following-sibling::*[@data-msg-id][1]");
      await expect(slot).toBeVisible();
      await expect(next).toBeAttached();
      await column.scrollIntoViewIfNeeded();
      await page.evaluate(async () => {
        await document.fonts.ready;
      });

      const measure = async () => {
        // 两帧让 ResizeObserver 和虚拟列表消费实际尺寸，避免只量到旧的 translateY。
        await page.evaluate(
          () =>
            new Promise<void>((resolve) => {
              requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
            }),
        );
        const [columnBox, slotBox, nextBox] = await Promise.all([
          column.boundingBox(),
          slot.boundingBox(),
          next.boundingBox(),
        ]);
        expect(columnBox).not.toBeNull();
        expect(slotBox).not.toBeNull();
        expect(nextBox).not.toBeNull();
        return { column: columnBox!, slot: slotBox!, next: nextBox! };
      };
      const before = await measure();
      expect(before.slot.height).toBeGreaterThan(0);
      expect(before.slot.height).toBeLessThanOrEqual(24);
      const stable = async () => {
        const current = await measure();
        expect(current.slot.height).toBeCloseTo(before.slot.height, 2);
        expect(current.column.height).toBeCloseTo(before.column.height, 2);
        expect(current.column.width).toBeCloseTo(before.column.width, 2);
        expect(current.next.y).toBeCloseTo(before.next.y, 1);
        expect(current.slot.width).toBeLessThanOrEqual(current.column.width + 0.5);
        expect(current.column.x).toBeGreaterThanOrEqual(-0.5);
        expect(current.column.x + current.column.width).toBeLessThanOrEqual(sample.width + 0.5);
      };

      const stages: Array<DownloadEntry | null> = [
        { phase: "downloading", received: 64, total: 256 },
        { phase: "saving", received: 256, total: 256 },
        { phase: "done", received: 256, total: 256 },
        { phase: "downloading", received: 64, total: 0 },
        { phase: "canceled", received: 64, total: 0 },
        {
          phase: "failed",
          received: 64,
          total: 256,
          errorKey: "download.directoryPermissionRequired",
        },
        null,
      ];
      for (const entry of stages) {
        await test.step(entry?.phase ?? "idle", async () => {
          await setProgress(page, id!, entry);
          await stable();
          if (entry && entry.phase !== "done" && entry.phase !== "canceled") {
            // 量真实间距，防止任意值工具类未产出 CSS 却只靠固定槽高通过测试。
            const bar = await slot.getByRole("progressbar").boundingBox();
            const caption = await slot.locator("p, button").boundingBox();
            expect(bar).not.toBeNull();
            expect(caption).not.toBeNull();
            expect(caption!.y - bar!.y - bar!.height).toBeCloseTo(2, 1);
          }
          if (entry?.phase === "failed") {
            const error = slot.getByRole("button");
            const detail = await error.textContent();
            await error.click();
            const dialog = page.getByRole("dialog");
            await expect(dialog).toBeVisible();
            await expect(dialog.locator("p")).toHaveText(detail!);
            const readable = await dialog.locator("p").evaluate((element) => ({
              width: element.clientWidth,
              scrollWidth: element.scrollWidth,
              height: element.clientHeight,
              scrollHeight: element.scrollHeight,
            }));
            expect(readable.scrollWidth).toBeLessThanOrEqual(readable.width + 1);
            expect(readable.scrollHeight).toBeLessThanOrEqual(readable.height + 1);
            await stable();
            await dialog.getByRole("button", { name: "关闭", exact: true }).click();
          }
        });
      }
    });
  }
});
