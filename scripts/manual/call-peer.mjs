/**
 * 实测脚本（不进 CI）：用网页端充当通话的一方，与另一端（Linux 桌面端 / 安卓真机）
 * 打一通真实电话。
 *
 * 这是整条链路唯一无法用单测覆盖的部分 —— 要两个真实客户端、真实信令、
 * 真实 ICE/DTLS 协商，且各端媒体实现互不相同（桌面端 webrtcbin、
 * 安卓 WebView libwebrtc、网页 libwebrtc）。
 *
 * 两种模式（脚本只演网页端这一侧，另一侧由人操作）：
 *
 *   call   <对端会话名> — 主叫：登录 → 打开会话 → 点通话按钮 → 等对方接听
 *   answer                — 被叫：登录 → 等来电 → 接听
 *
 * 判据是 `audioPacketsReceived > 0` —— 「connectionState=connected」不等于
 * 有声音，编解码不匹配时照样能连上却一片寂静。
 *
 * @example
 *   node scripts/manual/call-peer.mjs call Alice --media=audio --as=bob
 *   node scripts/manual/call-peer.mjs answer --as=bob
 */
import { createRequire } from "node:module";

const require = createRequire("/home/liaojie1314/code/project/yuanchat/apps/web/package.json");
const { chromium } = require("@playwright/test");

const BASE = "http://localhost:5173";
const API = "http://localhost:8085";

/** seed 里的测试账号（`server/cmd/seed/main.go`，密码统一 Test@1234） */
const ACCOUNTS = {
  alice: { account: "13800000001", password: "Test@1234" },
  bob: { account: "13800000002", password: "Test@1234" },
  carol: { account: "13800000003", password: "Test@1234" },
};

/** 对端响铃到人工接听之间的等待上限：真人要摸出手机、解锁、点接听 */
const ANSWER_TIMEOUT_MS = 180000;
/** 接通后保持通话的时长，留给人工观察画面与声音 */
const HOLD_MS = 45000;

function parseArgs(argv) {
  const positional = argv.filter((a) => !a.startsWith("--"));
  const flag = (name, fallback) => {
    const hit = argv.filter((a) => a.startsWith(`--${name}=`))[0];
    return hit ? hit.slice(name.length + 3) : fallback;
  };
  return {
    mode: positional[0] || "answer",
    peer: positional[1] || "",
    media: flag("media", "audio"),
    as: flag("as", "bob"),
    hold: Number(flag("hold", String(HOLD_MS))),
  };
}

async function login(who) {
  const res = await fetch(API + "/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(who),
  });
  const json = await res.json();
  if (json.code !== 0) throw new Error("登录失败: " + JSON.stringify(json));
  return json.data;
}

/** 从页面里问一次通话实况（连接态 + 收发包数 + 是否有远端轨） */
async function readStats(page) {
  return page.evaluate(async () => {
    const out = {
      hasDialog: !!document.querySelector('[role="dialog"]'),
      remoteTracks: 0,
      connectionState: "unknown",
      audioPacketsReceived: -1,
      audioPacketsSent: -1,
      videoPacketsReceived: -1,
    };
    // PeerMesh 不对外暴露 PeerConnection 实例，故在 init script 里把构造函数
    // 包了一层留下 __pcs —— 「有没有声音」只有 getStats 答得了
    const pcs = window.__pcs;
    if (pcs && pcs.length > 0) {
      const pc = pcs[pcs.length - 1];
      out.connectionState = pc.connectionState;
      const report = await pc.getStats();
      report.forEach((s) => {
        if (s.type === "inbound-rtp" && s.kind === "audio")
          out.audioPacketsReceived = s.packetsReceived || 0;
        if (s.type === "outbound-rtp" && s.kind === "audio")
          out.audioPacketsSent = s.packetsSent || 0;
        if (s.type === "inbound-rtp" && s.kind === "video")
          out.videoPacketsReceived = s.packetsReceived || 0;
      });
    }
    out.remoteTracks = Array.from(document.querySelectorAll("video")).filter(
      (v) => v.srcObject,
    ).length;
    return out;
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const who = ACCOUNTS[args.as];
  if (!who) throw new Error(`未知账号 ${args.as}，可选：${Object.keys(ACCOUNTS).join(" / ")}`);

  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    args: [
      // 假设备：免去授权弹窗，且放出可辨认的测试音（1kHz 蜂鸣）与滚动彩条，
      // 对端能直接听/看出「有没有流过来」
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const ctx = await browser.newContext({ permissions: ["microphone", "camera"], locale: "zh-CN" });
  const { access_token, refresh_token, user } = await login(who);

  await ctx.addInitScript(() => {
    const Orig = window.RTCPeerConnection;
    window.__pcs = [];
    const Wrapped = function (...a) {
      const pc = new Orig(...a);
      window.__pcs.push(pc);
      return pc;
    };
    Wrapped.prototype = Orig.prototype;
    window.RTCPeerConnection = Wrapped;
  });
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
  page.on("console", (m) => {
    const text = m.text();
    if (text.indexOf("[call]") >= 0 || m.type() === "error") console.log("  页面:", text);
  });
  await page.goto(BASE + "/chat");
  console.log(`PROBE: ${user.nickname}（网页端）已登录`);

  if (args.mode === "call") {
    // 会话行是普通 button，名字单独占一个 span。必须按**精确**文本定位那个
    // span：群会话的预览行长成「Alice: [通话]」，用 hasText 子串匹配会连群一起
    // 命中，点进去发起的是群通话（先弹选人框），完全不是要测的东西
    const row = page
      .locator("button")
      .filter({ has: page.getByText(args.peer, { exact: true }) })
      .first();
    await row.waitFor({ state: "visible", timeout: 30000 });
    await row.click();
    const label = args.media === "video" ? "视频通话" : "语音通话";
    // 顶栏的通话按钮在 sm 断点以下是隐藏的，默认 1280 视口够宽
    const btn = page.getByRole("button", { name: label, exact: true }).first();
    await btn.waitFor({ state: "visible", timeout: 15000 });
    await btn.click();
    console.log(`PROBE: 已向 ${args.peer} 发起${label} —— 请在手机上接听`);
  } else {
    const accept = page.getByRole("button", { name: "接听" });
    const rang = await accept
      .waitFor({ state: "visible", timeout: ANSWER_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false);
    console.log("PROBE: 网页端是否响铃 =", rang);
    if (!rang) {
      console.log('PROBE_RESULT {"error":"网页端未收到来电"}');
      await browser.close();
      process.exit(1);
    }
    await accept.click();
    console.log("PROBE: 已接听");
  }

  // 每 5s 报一次实况：人工接听的时刻不可预测，光等一个固定时长看不出
  // 「一直没人接」与「接了但没有声音」的区别
  const deadline = Date.now() + ANSWER_TIMEOUT_MS;
  let connectedAt = 0;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    const s = await readStats(page);
    if (s.connectionState === "connected" && connectedAt === 0) {
      connectedAt = Date.now();
      console.log("PROBE: 已接通 ✔");
    }
    console.log(
      `PROBE: state=${s.connectionState} 远端轨=${s.remoteTracks} ` +
        `收音频包=${s.audioPacketsReceived} 发音频包=${s.audioPacketsSent}` +
        (args.media === "video" ? ` 收视频包=${s.videoPacketsReceived}` : ""),
    );
    if (connectedAt > 0 && Date.now() - connectedAt > args.hold) break;
  }

  const final = await readStats(page);
  console.log("PROBE_RESULT " + JSON.stringify(final));
  await browser.close();
}

main().catch((e) => {
  console.log('PROBE_RESULT {"error":' + JSON.stringify(e.message) + "}");
  process.exit(1);
});
