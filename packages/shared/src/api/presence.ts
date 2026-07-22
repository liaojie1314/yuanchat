/** 好友在线快照：登录/重连时拉一次，此后由 presence 帧增量维护 */
import { apiGet } from "./client";

export async function fetchPresence(): Promise<string[]> {
  const data = await apiGet<{ online_ids: string[] }>("/api/v1/presence");
  return data.online_ids || [];
}
