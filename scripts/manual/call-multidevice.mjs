/**
 * 真机实测脚本（不进 CI）：同一账号开两个客户端时，服务端如何对待第二个连接。
 *
 * 场景：Bob 同时登录两个浏览器上下文（相当于第二台设备），Alice 呼叫 Bob，
 * 两端都响铃、都接听 —— 观察房间里出现了几个参与者。
 *
 * 用法：node scripts/manual/call-multidevice.mjs
 */
import { createRequire } from "node:module";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { chromium } = require("@playwright/test");

const BASE = "http://localhost:5173";
const API = "http://localhost:8085";
const ACCOUNTS = {
  alice: { account: "13800000001", password: "Test@1234" },
  bob: { account: "13800000002", password: "Test@1234" },
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

async function openAs(browser, who, tag) {
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
  return { tag, page, user };
}

/** 从页面里读通话态（CallView 的 dialog 是否出现 + 是否接通） */
async function callUi(page) {
  return page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"][aria-label="语音通话"]');
    const timer = Array.from(document.querySelectorAll("p")).find((p) =>
      /^\d{2}:\d{2}$/.test((p.textContent || "").trim()),
    );
    return { hasDialog: !!dlg, connected: !!timer };
  });
}

async function main() {
  const browser = await chromium.launch({
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });

  const alice = await openAs(browser, "alice", "Alice");
  const bob1 = await openAs(browser, "bob", "Bob设备1");
  const bob2 = await openAs(browser, "bob", "Bob设备2");

  // Alice 呼叫 Bob
  await alice.page.getByRole("button", { name: /Bob/ }).first().click();
  await alice.page.getByRole("button", { name: "语音通话" }).first().click();
  console.log("Alice 已发起呼叫 Bob");

  // 两个 Bob 是否都响铃？
  for (const b of [bob1, bob2]) {
    const accept = b.page.getByRole("button", { name: "接听" });
    const rang = await accept
      .waitFor({ state: "visible", timeout: 12000 })
      .then(() => true)
      .catch(() => false);
    console.log(`${b.tag} 是否响铃: ${rang ? "是" : "否"}`);
    if (rang) await accept.click();
  }

  await new Promise((r) => setTimeout(r, 6000));

  for (const p of [alice, bob1, bob2]) {
    console.log(`${p.tag} 通话界面: ${JSON.stringify(await callUi(p.page))}`);
  }

  // 直接问服务端：房间里到底有几个参与者
  const room = await bob1.page.evaluate(async () => {
    const auth = JSON.parse(localStorage.getItem("yuanchat-auth") || "{}");
    const me = auth?.state?.user?.id;
    // 从 store 里拿 callId
    const el = document.querySelector("[data-call-probe]");
    const callId = el ? JSON.parse(el.getAttribute("data-call-probe")).callId : null;
    if (!callId) return { error: "no call id in dom" };
    const r = await fetch("http://localhost:8085/api/v1/calls/" + callId, {
      headers: { Authorization: "Bearer " + auth?.state?.accessToken },
    });
    return { me, status: r.status, body: await r.json() };
  });
  console.log("房间快照:", JSON.stringify(room, null, 1).slice(0, 1500));

  await browser.close();
}

main().catch((e) => {
  console.error("\n❌ 失败:", e.message);
  process.exit(1);
});
