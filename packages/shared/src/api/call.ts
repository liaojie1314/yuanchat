/**
 * 通话 REST 客户端 — ICE 凭据签发与房间快照
 *
 * @description
 * 两个端点各只有一个调用方：
 * - `GET /calls/ice-servers`：建 `RTCPeerConnection` 前取 STUN/TURN 凭据
 *   （TURN 凭据是 HMAC 时效凭据，不能写死在前端，故必须走接口）
 * - `GET /calls/:call_id`：桌面通话窗口启动时拉快照 —— 窗口是在 `call.incoming`
 *   之后才创建的，它自己的 WS 连上时那一帧早已发完，不拉快照就没有房间信息可渲染
 */
import { apiGet } from "./client";
import type { CallMedia, CallParticipant } from "../ws/chatSocket";

/** ICE 凭据响应（与 `server/internal/service/call_service.go` 的 `ICEConfig` 对齐）。 */
export interface CallIceConfigDTO {
  ice_servers: RTCIceServer[];
  /** 凭据有效期（秒），客户端据此缓存 */
  ttl: number;
}

/**
 * 房间快照响应。
 *
 * @remarks 字段逐字对齐 `server/internal/handler/call.go` 的 `callRoomDTO` ——
 *   注意它给的是 `caller_id` 而不是主叫的完整资料：主叫昵称/头像已经随
 *   `call.incoming` / `call.state` 的 `participants` 一起下发过，快照不重复带。
 */
export interface CallRoomDTO {
  call_id: string;
  conversation_id: string;
  media: CallMedia;
  state: "ringing" | "active";
  caller_id: string;
  participants: CallParticipant[];
}

/**
 * 拉取 ICE 服务器列表与凭据有效期。
 *
 * @remarks 带 TTL 缓存的封装在 `webrtc/iceServers.ts`，业务侧应调那一个 ——
 *   本函数每次都真的打接口。
 */
export function fetchIceConfig(): Promise<CallIceConfigDTO> {
  return apiGet<CallIceConfigDTO>("/api/v1/calls/ice-servers");
}

/**
 * 拉取通话房间当前快照。
 *
 * @param callId - 通话 id
 * @throws ApiError code=403 非房间参与者 / code=404 房间不存在（已终结）
 */
export function fetchCall(callId: string): Promise<CallRoomDTO> {
  return apiGet<CallRoomDTO>("/api/v1/calls/" + encodeURIComponent(callId));
}
