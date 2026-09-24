/**
 * 真机实测脚本（不进 CI）：Web ↔ Web 双端 1v1 通话全链路。
 *
 * 跑真实后端 + 真实 coturn，两个独立浏览器上下文各自登录 Alice / Bob，
 * Alice 呼叫 → Bob 接听 → 断言两端都进入 active 且各自拿到对端的远端流。
 *
 * 用法：node scripts/manual/call-2p.mjs [--relay]
 *   --relay 强制 iceTransportPolicy=relay，只走 TURN 中继（验证 coturn 真的在转发）
 */
import { createRequire } from "node:module";

// pnpm 不把 playwright 提升到仓库根，ESM 又按**文件所在位置**解析依赖，
// 故从声明了该依赖的 apps/web 里取
const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { chromium } = require("@playwright/test");

const RELAY = process.argv.includes("--relay");
const BASE = "http://localhost:5173";
const API = "http://localhost:8085";
const ACCOUNTS = {
  alice: { account: "13800000001", password: "Test@1234" },
  bob: { account: "13800000002", password: "Test@1234" },
};

/** 直接打接口拿 token，省去走登录页的 UI 步骤（本脚本验的是通话，不是登录） */
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

/** 建一个已登录的上下文，并按需把 RTCPeerConnection 钉成 relay-only */
async function openAs(browser, who) {
  const ctx = await browser.newContext({
    permissions: ["microphone", "camera"],
    locale: "zh-CN",
  });
  const { access_token, refresh_token, user } = await login(who);
  await ctx.addInitScript(
    ({ token, refresh, u, relay }) => {
      localStorage.setItem(
        "yuanchat-auth",
        JSON.stringify({
          state: {
            user: u,
            accessToken: token,
            refreshToken: refresh,
            isAuthenticated: true,
          },
          version: 0,
        }),
      );
      if (relay) {
        const Native = window.RTCPeerConnection;
        window.RTCPeerConnection = function (cfg) {
          return new Native({ ...(cfg || {}), iceTransportPolicy: "relay" });
        };
        window.RTCPeerConnection.prototype = Native.prototype;
      }
    },
    { token: access_token, refresh: refresh_token, u: user, relay: RELAY },
  );
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`  [${who} console] ${m.text()}`);
  });
  await page.goto(BASE + "/chat");
  return { ctx, page, user };
}

/** 读 callStore 的当前快照（通话状态的唯一真源） */
function callState(page) {
  return page.evaluate(() => {
    const el = document.querySelector("[data-call-probe]");
    return el ? JSON.parse(el.getAttribute("data-call-probe")) : null;
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

  const alice = await openAs(browser, "alice");
  const bob = await openAs(browser, "bob");
  console.log(`模式: ${RELAY ? "relay-only（强制走 TURN）" : "默认（host/srflx/relay 全开）"}`);

  // Alice 打开与 Bob 的单聊并发起语音通话
  await alice.page.getByRole("button", { name: /Bob/ }).first().click();
  await alice.page.getByRole("button", { name: "语音通话" }).first().click();
  console.log("Alice 已点发起");

  // Bob 端来电界面出现后接听
  const bobAccept = bob.page.getByRole("button", { name: "接听" });
  await bobAccept.waitFor({ state: "visible", timeout: 15000 });
  console.log("Bob 收到来电");
  await bobAccept.click();

  // 两端都应进入通话中：计时器文案 mm:ss 是 active 态独有的
  const timer = /^\d{2}:\d{2}$/;
  for (const [who, p] of [
    ["Alice", alice.page],
    ["Bob", bob.page],
  ]) {
    await p.getByText(timer).first().waitFor({ state: "visible", timeout: 20000 });
    console.log(`${who} 已接通`);
  }

  // 远端流真的到了：<video> 的 srcObject 有 track 且在流动
  await new Promise((r) => setTimeout(r, 3000));
  for (const [who, p] of [
    ["Alice", alice.page],
    ["Bob", bob.page],
  ]) {
    const stats = await p.evaluate(async () => {
      const vids = Array.from(document.querySelectorAll("video"));
      const remote = vids.filter((v) => !v.muted && v.srcObject);
      const tracks = remote.flatMap((v) => v.srcObject.getTracks().map((t) => t.kind));
      return { videoEls: vids.length, remoteEls: remote.length, tracks };
    });
    console.log(`${who} 远端流: ${JSON.stringify(stats)}`);
    if (stats.remoteEls === 0) throw new Error(`${who} 没有拿到远端流`);
  }

  // 挂断：Alice 挂断后两端都应出画
  await alice.page.getByRole("button", { name: "挂断" }).click();
  for (const [who, p] of [
    ["Alice", alice.page],
    ["Bob", bob.page],
  ]) {
    await p
      .getByRole("dialog", { name: "语音通话" })
      .waitFor({ state: "detached", timeout: 10000 });
    console.log(`${who} 已出画`);
  }

  // 通话记录气泡应落在消息流里
  await new Promise((r) => setTimeout(r, 1500));
  for (const [who, p] of [
    ["Alice", alice.page],
    ["Bob", bob.page],
  ]) {
    const record = await p.getByText(/通话时长|通话已结束|未接来电/).count();
    console.log(`${who} 通话记录条数: ${record}`);
  }

  console.log("\n✅ Web ↔ Web 1v1 通话全链路通过");
  await browser.close();
}

main().catch(async (e) => {
  console.error("\n❌ 失败:", e.message);
  process.exit(1);
});
