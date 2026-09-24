/**
 * ICE 服务器列表 — 带 TTL 缓存的取用入口
 *
 * @description
 * TURN 凭据是 HMAC 时效凭据（`username = <unix_expiry>:<user_id>`），服务端连同
 * 有效期一起下发。群通话里每建一条 PeerConnection 都要一份，若每次都打接口，
 * 4 人房间的一次成员变更就是 3 个并发请求 —— 故按服务端给的 TTL 缓存在模块级。
 */
import { fetchIceConfig } from "../api/call";
import { captureException } from "../observability/sentry";

/** 提前失效的余量：凭据在建连过程中过期会让 relay 候选直接被 TURN 服务器拒掉 */
const EXPIRY_MARGIN_MS = 60_000;

/**
 * 拉取失败时的兜底：只有 STUN。
 *
 * @remarks 刻意**不**返回空数组 —— 空数组会让 WebRTC 只收集 host 候选，在跨 NAT
 *   场景下静静地连不通，用户只看到永远的「连接中…」。给一条 STUN 至少让同网段可用，
 *   同时错误已上报 Sentry。
 */
const FALLBACK: RTCIceServer[] = [{ urls: ["stun:localhost:3478"] }];

let cache: { servers: RTCIceServer[]; expiresAt: number } | null = null;

/**
 * 取当前可用的 ICE 服务器列表（TTL 内复用缓存）。
 *
 * @returns 服务器列表；接口失败时返回仅含 STUN 的兜底列表（不抛错 —— 通话流程
 *   不该因为取不到 TURN 就整体中断）
 */
export async function fetchIceServers(): Promise<RTCIceServer[]> {
  if (cache !== null && Date.now() < cache.expiresAt) return cache.servers;
  try {
    const config = await fetchIceConfig();
    const servers = config.ice_servers || FALLBACK;
    const ttlMs = (config.ttl > 0 ? config.ttl : 3600) * 1000;
    cache = { servers, expiresAt: Date.now() + Math.max(ttlMs - EXPIRY_MARGIN_MS, 0) };
    return servers;
  } catch (err) {
    captureException(err instanceof Error ? err : new Error("fetch ice servers failed"));
    return FALLBACK;
  }
}

/** 清空缓存（登出换账号时凭据里的 user_id 已失效；单测隔离亦用它）。 */
export function resetIceServersCache(): void {
  cache = null;
}
