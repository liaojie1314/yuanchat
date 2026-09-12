/**
 * useCallWindow — 桌面端「通话开独立原生窗口」的主窗口侧控制器
 *
 * @description
 * Tauri 的每个 `WebviewWindow` 是独立 JS 上下文：`MediaStream` 与
 * `RTCPeerConnection` 不能跨窗口传递，视频要在哪渲染，PeerConnection 就必须
 * 建在哪。因此通话窗口自建一条 WebSocket，成为房间里**真正的参与者**
 * （服务端按连接定址，见设计文档 §3.2）；主窗口这边只负责两件事：
 *
 * 1. **拦下发起动作**：四个入口（顶栏、宫格、会话详情、联系人详情）调的
 *    `startCall` / `joinCall` 经 {@link setCallLauncher} 整体转成一次「开窗」，
 *    主窗口既不取媒体也不发信令 —— 否则房间里登记的是主窗口那条连接。
 * 2. **来电时开窗**：`call.incoming` 由主窗口的 WS 收到（服务端按用户推给全部
 *    连接），据此开窗并**立刻把主窗口的通话态复位为 idle** —— 通话态归通话
 *    窗口所有，两边都持有会在挂断时互相打架。
 *
 * 重复开窗由 `getByLabel("call")` 去重：已有窗口时只做 setFocus。
 */
import { useEffect } from "react";
import { useCallStore } from "@yuanchat/shared";
import { setCallLauncher } from "@yuanchat/ui";
import type { CallLaunchRequest } from "@yuanchat/ui";

/** 通话窗口的固定 label：同时用于去重与 capabilities 授权 */
const CALL_WINDOW_LABEL = "call";

/** 通话窗口尺寸：4 人 mesh 的 2×2 网格在这个尺寸下每格仍有 ~460×300 */
const CALL_WINDOW_SIZE = { width: 960, height: 680 };

/** 承载一通电话所需的全部参数（经 URL query 交给 `/call` 路由） */
export interface CallWindowParams {
  /** `callee` 是 {@link CallLaunchRequest} 之外的第三条路：由 `call.incoming` 触发 */
  role: CallLaunchRequest["role"] | "callee";
  media: CallLaunchRequest["media"];
  callId?: string;
  conversationId?: string;
  inviteeIds?: string[];
}

/**
 * 把开窗参数编成 `/call` 的查询串。
 *
 * @remarks 独立导出是为了可单测 —— 参数漏一个的后果是通话窗口开起来却是空白，
 *   而那只在两端同时在线时才能复现。
 */
export function callWindowQuery(p: CallWindowParams): string {
  const q = new URLSearchParams();
  q.set("role", p.role);
  q.set("media", p.media);
  if (p.callId) q.set("call_id", p.callId);
  if (p.conversationId) q.set("conversation_id", p.conversationId);
  if (p.inviteeIds && p.inviteeIds.length > 0) q.set("invitees", p.inviteeIds.join(","));
  return q.toString();
}

/**
 * 开（或聚焦）通话窗口。
 *
 * @remarks url 用相对路径：Tauri 会按 dev 的 `devUrl` / 生产的 `frontendDist`
 *   各自解析，两边都无需判断环境。
 */
async function openCallWindow(p: CallWindowParams): Promise<void> {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const existing = await WebviewWindow.getByLabel(CALL_WINDOW_LABEL);
  if (existing) {
    await existing.setFocus();
    return;
  }
  new WebviewWindow(CALL_WINDOW_LABEL, {
    url: "/call?" + callWindowQuery(p),
    title: "YuanChat",
    width: CALL_WINDOW_SIZE.width,
    height: CALL_WINDOW_SIZE.height,
    center: true,
    resizable: true,
    // 与主窗口、注册/登录窗口一致关掉系统边框：应用自绘标题栏，
    // 留着原生边框会让通话窗口在四个窗口里显得格格不入
    decorations: false,
  });
}

/**
 * 主窗口侧接线。
 *
 * @param enabled - 仅桌面端主窗口传 true；移动端（浮层承载）与通话窗口自身传 false
 */
export function useCallWindow(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    const launch = (p: CallWindowParams) => {
      void openCallWindow(p).catch((e) => {
        // 开窗失败与「没开窗」外观完全一致 —— 按钮点了没反应，没有任何线索。
        // 缺 capabilities 权限就是这么失败的（实测漏了
        // core:webview:allow-create-webview-window 时，四个入口全部静默失效）。
        // 浏览器里跑桌面 SPA 时这里也会抛，属预期，故只记不弹
        console.error("[call] 通话窗口打开失败:", e);
      });
      // 通话态归通话窗口所有：主窗口留着半个状态会在挂断时互相打架
      useCallStore.getState().reset();
    };

    setCallLauncher((req) => {
      launch(req);
      return true;
    });

    const unsubscribe = useCallStore.subscribe((s, prev) => {
      // 只认「新来的一通电话」：phase 已经是 incoming 时的字段变化不再开窗
      if (s.phase !== "incoming" || prev.phase === "incoming" || !s.callId) return;
      launch({
        role: "callee",
        media: s.media,
        callId: s.callId,
        conversationId: s.conversationId || undefined,
      });
    });

    return () => {
      setCallLauncher(null);
      unsubscribe();
    };
  }, [enabled]);
}
