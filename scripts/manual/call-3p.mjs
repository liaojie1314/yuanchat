/**
 * 真机实测脚本（不进 CI）：群通话 3 人 mesh 全连接。
 *
 * Alice 在群里选中 Bob + Carol 发起 → 两人各自接听 →
 * 断言三端都进入 active，且每端各拿到 2 路远端流（mesh 全连接 = N-1 条 PC）。
 *
 * 用法：node scripts/manual/call-3p.mjs
 */
import { createRequire } from "node:module";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { chromium } = require("@playwright/test");

const BASE = "http://localhost:5173";
const API = "http://localhost:8085";
const GROUP = "产品研发群";
const ACCOUNTS = {
  Alice: { account: "13800000001", password: "Test@1234" },
  Bob: { account: "13800000002", password: "Test@1234" },
  Carol: { account: "13800000003", password: "Test@1234" },
};

async function login(who) {
  const res = await fetch(API + "/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ACCOUNTS[who]),
  });
  const json = await res.json();
  if (json.code !== 0) throw new Error(who + " 登录失败: " + JSON.stringify(json));
  return json.data;
}

async function openAs(browser, who) {
  const ctx = await browser.newContext({ permissions: ["microphone", "camera"], locale: "zh-CN" });
  const { access_token, refresh_token, user } = await login(who);
  await ctx.addInitScript(
    ({ token, refresh, u }) => {
      localStorage.setItem(
        "yuanchat-auth",
        JSON.stringify({
          state: { user: u, accessToken: token, refreshToken: refresh, isAuthenticated: true },
          version: 0,
        }),
      );
    },
    { token: access_token, refresh: refresh_token, u: user },
  );
  const page = await ctx.newPage();
  await page.goto(BASE + "/chat");
  return { who, page };
}

/** 数远端 <video>（非 muted 且有 srcObject 的即为对端格子） */
function remoteCount(page) {
  return page.evaluate(
    () =>
      Array.from(document.querySelectorAll("video")).filter((v) => !v.muted && v.srcObject).length,
  );
}

async function main() {
  const browser = await chromium.launch({
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });

  const alice = await openAs(browser, "Alice");
  const bob = await openAs(browser, "Bob");
  const carol = await openAs(browser, "Carol");

  // Alice 在群里发起：群聊必须先选人（mesh 上限 4）
  await alice.page.getByRole("button", { name: new RegExp(GROUP) }).first().click();
  await alice.page.getByRole("button", { name: "语音通话" }).first().click();
  const modal = alice.page.getByRole("dialog", { name: "选择通话成员" });
  await modal.waitFor({ state: "visible", timeout: 10000 });
  const candidates = modal.locator("button[aria-pressed]");
  const n = await candidates.count();
  console.log(`选人弹窗候选 ${n} 人，全选后发起`);
  for (let i = 0; i < Math.min(n, 3); i++) await candidates.nth(i).click();
  await modal.getByRole("button", { name: "语音通话" }).click();
  console.log("Alice 已发起群通话");

  // Bob / Carol 接听
  for (const p of [bob, carol]) {
    const accept = p.page.getByRole("button", { name: "接听" });
    await accept.waitFor({ state: "visible", timeout: 20000 });
    await accept.click();
    console.log(`${p.who} 已接听`);
  }

  // 三端都接通
  const timer = /^\d{2}:\d{2}$/;
  for (const p of [alice, bob, carol]) {
    await p.page.getByText(timer).first().waitFor({ state: "visible", timeout: 25000 });
    console.log(`${p.who} 已接通`);
  }

  // mesh 全连接：每端应有 2 路远端流
  await new Promise((r) => setTimeout(r, 5000));
  let ok = true;
  for (const p of [alice, bob, carol]) {
    const c = await remoteCount(p.page);
    console.log(`${p.who} 远端流数 = ${c}（期望 2）`);
    if (c !== 2) ok = false;
  }
  if (!ok) throw new Error("mesh 未全连接");

  // Carol 离开：另两端应各减一路，且通话继续
  await carol.page.getByRole("button", { name: "挂断" }).click();
  console.log("Carol 已离开");
  await new Promise((r) => setTimeout(r, 3000));
  for (const p of [alice, bob]) {
    const c = await remoteCount(p.page);
    console.log(`${p.who} 远端流数 = ${c}（期望 1）`);
    if (c !== 1) throw new Error(`${p.who} 未撤掉离开者的格子`);
  }

  await alice.page.getByRole("button", { name: "挂断" }).click();
  console.log("\n✅ 群通话 3 人 mesh 全链路通过");
  await browser.close();
}

main().catch((e) => {
  console.error("\n❌ 失败:", e.message);
  process.exit(1);
});
