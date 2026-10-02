/**
 * 本地库的登录 / 登出生命周期接线。
 *
 * 单独成文件而不是塞进 outboxSync：恢复待发队列要往 messageStore 写，而
 * messageStore 自己 import outboxSync —— 放在那边就是一个真·循环依赖。
 */
import { initLocalStore } from "../localdb";
import { restoreOutbox } from "./outboxSync";
import { useAuthStore } from "./authStore";
import { useConversationStore } from "./conversationStore";
import { reconcileConversation } from "./messageLocalSync";
import { useMessageStore } from "./messageStore";

/**
 * 登录后打开本地库，并把上次没发出去的消息恢复成 `failed` 气泡。
 *
 * 返回 false 即降级模式（IDB 不可用）：调用方**照常继续**，不得阻塞登录 ——
 * 应用行为退化成纯内存，与引入本地库之前完全一致。
 *
 * 必须在拉会话列表**之前** await：冷启动水合要靠库句柄，开晚了本地数据白存。
 */
export async function startLocalStore(userId: string): Promise<boolean> {
  const ok = await initLocalStore(userId);
  if (!ok) return false;
  const pending = await restoreOutbox();
  if (pending.length === 0) return true;
  // 用 receiveMessage 而不是直接 setState：它自带按 id / clientMsgId 去重，
  // 重复调用（如 StrictMode 下 effect 跑两遍）不会把同一条恢复成两个气泡
  const receive = useMessageStore.getState().receiveMessage;
  for (const msg of pending) receive(msg);
  return true;
}

/** 回前台对账的最小间隔：短于此视为同一次切换 */
const FOREGROUND_RECONCILE_MS = 30_000;

/**
 * 上次对账时刻。模块级而非组件 ref：节流是「这台设备这一次会话」的属性，
 * 与哪个组件挂载无关；桌面端切窗口不会重挂组件，放 ref 里反而更不稳。
 *
 * 刻意**不落 IDB**：节流只为了压住反复切 tab 的噪音，进程重启后本就该对一次账
 * （冷启动水合出来的内容可能已经过时），为此在每次可见性变化上加一次异步读不值得。
 */
let lastReconcileAt = 0;

/**
 * 桌面/移动端回到前台时，给当前打开的会话静默对一次账。
 *
 * 「静默」= 不转圈、不弹提示：失败就等下一次机会，用户手上那屏内容照旧。
 * 没打开会话或未登录时直接返回，**且不消耗节流窗口** —— 否则在通讯录页切一次
 * tab 就把接下来 30 秒的对账机会白白用掉了。
 */
export function reconcileOnForeground(): void {
  const convId = useConversationStore.getState().activeId;
  const uid = useAuthStore.getState().user?.id;
  if (convId === null || convId === "" || uid === undefined) return;
  const now = Date.now();
  if (now - lastReconcileAt < FOREGROUND_RECONCILE_MS) return;
  lastReconcileAt = now;
  void reconcileConversation(convId, uid);
}

/** 仅测试用：重置节流窗口 */
export function __resetForegroundReconcile(): void {
  lastReconcileAt = 0;
}
