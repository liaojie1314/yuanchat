/**
 * 实测脚本（不进 CI）：Linux 桌面端（GStreamer 原生后端）↔ 网页端 真实通话。
 *
 * 这是整条链路唯一无法用单测覆盖的部分 —— 要两个真实客户端、真实信令、
 * 真实 ICE/DTLS 协商，且桌面端走的是与网页端**完全不同**的媒体实现
 * （webrtcbin vs 浏览器 libwebrtc）。
 *
 * 本脚本只负责网页端（Bob）这一侧：登录、等来电、接听、数 RTP 包。
 * 桌面端（Alice）那侧由 xdotool 驱动，见同目录的调用说明。
 *
 * 判据是 `audioPacketsReceived > 0` —— 「connectionState=connected」不等于
 * 有声音，编解码不匹配时照样能连上却一片寂静。
 */
import { createRequire } from "node:module";

const require = createRequire("/home/liaojie1314/code/project/yuanchat/apps/web/package.json");
const { chromium } = require("@playwright/test");

const BASE = "http://localhost:5173";
const API = "http://localhost:8085";
const BOB = { account: "13800000002", password: "Test@1234" };

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

async function main() {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const ctx = await browser.newContext({ permissions: ["microphone", "camera"], locale: "zh-CN" });
  const { access_token, refresh_token, user } = await login(BOB);
  // 捕获页面建的每一条 PeerConnection：PeerMesh 不对外暴露实例，而判「有没有声音」
  // 只能靠 getStats。init script 在页面脚本之前执行，故不会漏掉任何一条
  await ctx.addInitScript(() => {
    const Orig = window.RTCPeerConnection;
    window.__pcs = [];
    const Wrapped = function (...args) {
      const pc = new Orig(...args);
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
  await page.goto(BASE + "/chat");
  console.log("PROBE: Bob(网页端) 已登录，等待来电…");

  // 桌面端那侧由 xdotool 逐步驱动（激活窗口、点会话、点通话按钮），
  // 比脚本自己发起慢得多，等待窗口要留足余量
  const accept = page.getByRole("button", { name: "接听" });
  const rang = await accept
    .waitFor({ state: "visible", timeout: 300000 })
    .then(() => true)
    .catch(() => false);
  console.log("PROBE: 网页端是否响铃 =", rang);
  if (!rang) {
    console.log('PROBE_RESULT {"error":"网页端未收到来电"}');
    await browser.close();
    process.exit(1);
  }
  await accept.click();
  console.log("PROBE: 已接听，等待媒体…");

  // 给 ICE/DTLS 协商与 RTP 起流留时间
  await new Promise((r) => setTimeout(r, 15000));

  const stats = await page.evaluate(async () => {
    // 从页面里找到活着的 RTCPeerConnection：PeerMesh 不暴露实例，
    // 故改用 getStats 的替代路径 —— 直接问所有 video/audio 元素的轨道
    const out = {
      hasDialog: !!document.querySelector('[role="dialog"]'),
      remoteTracks: 0,
      audioPacketsReceived: -1,
      audioPacketsSent: -1,
      connectionState: "unknown",
    };
    const pcs = window.__yuanchatPeers;
    if (pcs && pcs.length > 0) {
      const pc = pcs[0];
      out.connectionState = pc.connectionState;
      const report = await pc.getStats();
      report.forEach((s) => {
        if (s.type === "inbound-rtp" && s.kind === "audio")
          out.audioPacketsReceived = s.packetsReceived || 0;
        if (s.type === "outbound-rtp" && s.kind === "audio")
          out.audioPacketsSent = s.packetsSent || 0;
      });
    }
    const vids = Array.from(document.querySelectorAll("video"));
    out.remoteTracks = vids.filter((v) => v.srcObject).length;
    return out;
  });
  console.log("PROBE_RESULT " + JSON.stringify(stats));
  await browser.close();
}

main().catch((e) => {
  console.log('PROBE_RESULT {"error":' + JSON.stringify(e.message) + "}");
  process.exit(1);
});
