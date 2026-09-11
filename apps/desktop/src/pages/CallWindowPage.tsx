/**
 * CallWindowPage — 桌面端独立通话窗口的页面（路由 `/call`）
 *
 * @description
 * 这个窗口**自己**建一条 WebSocket（{@link useCallSocket}）而不是复用主窗口的：
 * Tauri 每个 `WebviewWindow` 是独立 JS 上下文，`MediaStream` 与
 * `RTCPeerConnection` 不能跨窗口传递，视频要在哪渲染，PeerConnection 就必须建在
 * 哪，随之 `call.invite` / `call.answer` 也必须由它自己的连接发出 ——
 * 服务端按连接定址（设计文档 §3.2），发错连接的后果是房间里登记的是主窗口，
 * 对方看得到人进来却永远没有画面。
 *
 * 启动参数由 `useCallWindow` 经 URL query 交接，按 `role` 分三条路：
 *
 * | role     | 来路                 | 动作                                        |
 * | -------- | -------------------- | ------------------------------------------- |
 * | `caller` | 本端点了通话按钮     | 取媒体 → 发 `call.invite`                   |
 * | `callee` | 收到 `call.incoming` | 拉 `GET /calls/:id` 快照 → 渲染来电界面     |
 * | `joiner` | 点了会话横幅「加入」 | 取媒体 → 发 `call.answer{accept:true}`      |
 *
 * `callee` 必须拉快照：窗口是在 `call.incoming` **之后**才被创建的，它自己的 WS
 * 连上时那一帧早已发完，不拉就没有房间信息可渲染（顺带让通话窗口刷新/重开可恢复）。
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { chatSocket, fetchCall, showToast, useCallSocket, useCallStore } from "@yuanchat/shared";
import { CallView, probeLocalMedia } from "@yuanchat/ui";

/** 最小化后的悬浮窗尺寸：容得下 CallView 那条悬浮条（顶距 4rem + 44px 按钮） */
const MINI_SIZE = { width: 300, height: 160 };
const FULL_SIZE = { width: 960, height: 680 };

/** 关掉本窗口；非 Tauri 环境（浏览器里跑桌面 SPA）静默忽略。 */
async function closeSelf(): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  } catch {
    /* 非 Tauri 环境 */
  }
}

export function CallWindowPage() {
  const { t } = useTranslation();
  useCallSocket();

  const phase = useCallStore((s) => s.phase);
  const minimized = useCallStore((s) => s.minimized);
  // 首帧就读死 query：通话中不会再变，放进 state 省得每次渲染重新解析
  const [params] = useState(() => new URLSearchParams(window.location.search));
  // 启动动作只能跑一次：React 18 StrictMode 下 effect 会被刻意执行两遍，
  // 不挡住的话会发出两份 call.invite（服务端按连接建房，第二份直接撞忙线）
  const started = useRef(false);
  // 通话是否真的开始过：本页首帧 phase 就是 idle，不区分「还没开始」与
  // 「已经结束」的话，窗口会在打开的同一帧把自己关掉
  const wasLive = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const role = params.get("role");
    const media = params.get("media") === "video" ? "video" : "audio";
    const callId = params.get("call_id") || "";
    const convId = params.get("conversation_id") || "";
    const invitees = (params.get("invitees") || "").split(",").filter(Boolean);
    const store = useCallStore.getState();

    void (async () => {
      if (role === "callee") {
        try {
          const room = await fetchCall(callId);
          const caller = room.participants.filter((p) => p.user_id === room.caller_id)[0];
          store.applyIncoming({
            call_id: room.call_id,
            conversation_id: room.conversation_id,
            media: room.media,
            caller: {
              id: room.caller_id,
              nickname: caller ? caller.nickname : "",
              avatar_url: caller ? caller.avatar_url : null,
              short_id: 0,
            },
            participants: room.participants,
          });
        } catch {
          // 404 = 房间已终结（对方在开窗这几百毫秒里挂了），没有可渲染的通话
          showToast("info", t("call.gone"));
          void closeSelf();
        }
        return;
      }

      if (!(await probeLocalMedia(media))) {
        void closeSelf();
        return;
      }

      if (role === "joiner") {
        // 复用 outgoing 态显示「连接中」：本端已经决定加入，等的是服务端把
        // 自己写进房间后回的那帧 call.state（它带着 self_conn 才能建 mesh）
        store.startOutgoing(convId, media, []);
        chatSocket.send("call.answer", { call_id: callId, accept: true });
        return;
      }

      store.startOutgoing(convId, media, invitees);
      chatSocket.send("call.invite", {
        conversation_id: convId,
        media,
        invitee_ids: invitees.length > 0 ? invitees : undefined,
      });
    })();
  }, [params, t]);

  // 通话结束（挂断 / 对方拒接 / 超时）→ 关窗。窗口留着就是一块黑屏
  useEffect(() => {
    if (phase !== "idle") {
      wasLive.current = true;
      return;
    }
    if (wasLive.current) void closeSelf();
  }, [phase]);

  // 最小化 = 缩成置顶悬浮窗；还原则复位。组件全程不卸载，mesh 与本地轨都还在
  useEffect(() => {
    void (async () => {
      try {
        const { getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        const size = minimized ? MINI_SIZE : FULL_SIZE;
        await win.setSize(new LogicalSize(size.width, size.height));
        await win.setAlwaysOnTop(minimized);
        if (!minimized) await win.center();
      } catch {
        /* 非 Tauri 环境 */
      }
    })();
  }, [minimized]);

  return <CallView />;
}
