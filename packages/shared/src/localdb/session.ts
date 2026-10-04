/**
 * 本地库的进程内单例：持有「当前账号的库句柄」。
 *
 * 句柄访问器 localDb() 刻意是**同步**的 —— store 的每个写路径都 await 一个
 * 句柄会把它们全变成异步，而在降级模式（IDB 不可用）下这些 await 全是白等。
 */
import { openLocalDb, deleteLocalDb } from "./db";

let current: IDBDatabase | null = null;
let currentUserId: string | null = null;

/**
 * 打开指定账号的本地库并缓存句柄，返回本地库是否可用。
 *
 * 返回 false 即降级模式：调用方跳过一切本地读写，应用行为退化成纯内存
 * （与引入 L1 之前完全一致），**不得因此报错或阻塞登录**。
 */
export async function initLocalStore(userId: string): Promise<boolean> {
  if (currentUserId === userId && current !== null) return true;
  closeLocalStore();
  const db = await openLocalDb(userId);
  if (db === null) return false;
  current = db;
  currentUserId = userId;
  return true;
}

/** 当前账号的库句柄；null 表示降级模式，调用方应跳过本地读写。 */
export function localDb(): IDBDatabase | null {
  return current;
}

/** 关闭句柄（不删库）。切账号与登出都先走这里。 */
export function closeLocalStore(): void {
  if (current !== null) {
    current.close();
    current = null;
  }
  currentUserId = null;
}

/**
 * 关闭并删除当前账号的库。
 *
 * 登出/切号时调用：一个账号一个库，删库即彻底清掉跨账号残留。
 * 未初始化时是 no-op（登出路径可能在登录失败后被调用）。
 */
export async function purgeLocalStore(): Promise<void> {
  const userId = currentUserId;
  closeLocalStore();
  if (userId === null) return;
  await deleteLocalDb(userId);
}
