/**
 * 本地库的登录 / 登出生命周期接线。
 *
 * 单独成文件而不是塞进 outboxSync：恢复待发队列要往 messageStore 写，而
 * messageStore 自己 import outboxSync —— 放在那边就是一个真·循环依赖。
 */
import { initLocalStore } from "../localdb";
import { restoreOutbox } from "./outboxSync";
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
