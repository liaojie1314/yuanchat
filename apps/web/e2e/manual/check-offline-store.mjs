/**
 * 离线本地库端到端验证（手动执行，不进 CI —— 需要真实后端与生产构建）。
 *
 * 跑法：`pnpm --filter @yuanchat/web check:offline`，前置见
 * `docs/DEVELOPMENT.md`「验证离线本地库」一节（起真后端 + 关 Mock 打生产构建 + vite preview）。
 *
 * 验证链路：
 *  1. 在线登录 → 拉到会话列表与历史消息 → 本地库落盘
 *  2. 断网（Playwright offline）→ **整页重载** → 列表与消息仍能渲染
 *  3. 验证离线横幅出现
 *  4. 恢复网络 → 「已连接」提示出现
 *
 * 第 2 步是关键：重载会清空所有内存状态，渲染得出来就只能来自 IndexedDB。
 *
 * 必须打**生产构建**（`vite preview`）：dev server 下 JS 模块按需从服务端拉取，
 * 断网后连应用代码都加载不到，页面直接白屏 —— 那是 dev 的特性，不是本地库失效。
 * 生产构建有 Service Worker 预缓存 app shell，才对应真实离线场景。
 *
 * 且构建时必须显式 `VITE_ENABLE_MOCK=false`：`.env.development` 默认开 Mock，
 * 断网后渲染出的会是 MSW demo 数据，离线「通过」纯属假阳性。
 */
import { chromium } from "@playwright/test";

const WEB = process.env.WEB_URL || "http://localhost:4173";
// 相对脚本自身定位，不依赖运行时 cwd
const OUT = new URL("../../../../docs/screenshots/", import.meta.url).pathname;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();

// ---- 1. 在线登录并落盘 ----
await page.goto(`${WEB}/login`, { waitUntil: "networkidle" });
await page.getByPlaceholder("元聊号").fill("13800000001");
await page.locator('input[type="password"]').fill("Test@1234");
await page.getByRole("button", { name: "登录", exact: true }).click();
await page.waitForURL(/\/chat/, { timeout: 15000 });
await page.getByText("产品研发群").first().waitFor({ timeout: 15000 });

// 进会话，把历史消息也拉进本地库
await page.getByText("产品研发群").first().click();
await page.waitForTimeout(3000);

// 确认本地库真的有数据
const counts = await page.evaluate(async () => {
  const dbs = await indexedDB.databases();
  const name = dbs.map((d) => d.name).find((n) => n && n.includes("yuanchat"));
  if (!name) return { db: null };
  return await new Promise((resolve) => {
    const req = indexedDB.open(name);
    req.onsuccess = () => {
      const db = req.result;
      const stores = Array.from(db.objectStoreNames);
      const tx = db.transaction(stores, "readonly");
      const out = { db: name, stores: {} };
      let left = stores.length;
      for (const s of stores) {
        const cr = tx.objectStore(s).count();
        cr.onsuccess = () => {
          out.stores[s] = cr.result;
          if (--left === 0) resolve(out);
        };
      }
    };
    req.onerror = () => resolve({ db: name, error: true });
  });
});
console.log("IndexedDB:", JSON.stringify(counts));

// ---- 2. 断网 + 整页重载 ----
// 先等 Service Worker 真的接管：没激活就断网，重载照样白屏
const swReady = await page.evaluate(async () => {
  if (!("serviceWorker" in navigator)) return "unsupported";
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  return reg?.active?.state ?? "none";
});
console.log("ServiceWorker:", swReady);

await ctx.setOffline(true);
await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
await page.waitForTimeout(3500);

const listVisible = (await page.getByText("产品研发群").count()) > 0;
const bannerVisible = (await page.getByText("当前无网络").count()) > 0;
console.log(listVisible ? "OK: 离线重载后会话列表仍在（来自本地库）" : "FAIL: 离线重载后列表空");
console.log(bannerVisible ? "OK: 离线横幅出现" : "FAIL: 离线横幅未出现");

// 列表能渲染只证明会话元数据落了盘，还要进会话确认历史消息也来自本地库
await page.getByText("产品研发群").first().click();
await page.waitForTimeout(2000);
const bubbles = await page.locator("[data-msg-id]").count();
console.log(bubbles > 0 ? `OK: 离线历史消息渲染 ${bubbles} 条（来自本地库）` : "FAIL: 离线会话内无消息");

await page.screenshot({ path: `${OUT}web-offline.png` });
console.log("saved web-offline.png");

// ---- 3. 恢复网络 ----
await ctx.setOffline(false);
let restored = false;
for (let i = 0; i < 40; i++) {
  if ((await page.getByText("已连接").count()) > 0) {
    restored = true;
    break;
  }
  await page.waitForTimeout(250);
}
console.log(restored ? "OK: 恢复后出现「已连接」" : "FAIL: 恢复后未提示");

await browser.close();
