/**
 * 认证 REST API — 忘记密码三段式改密 + 扫码登录被扫端
 *
 * @description
 * 改密对应后端 `POST /auth/password/otp` → `/auth/password/verify` → `/auth/password/reset`；
 * 扫码登录的被扫端对应 `POST /auth/qr/session` 与 `GET /auth/qr/:token`。
 * 全部端点均无需鉴权（用户此时正是登不进去才来走这两条链路）。
 *
 * 改密契约要点（由后端实现钉死，前端不得自行加工）：
 * - 发码成功是 204 空响应；**手机号未注册时响应完全相同**，前端因此无法、也绝不能
 *   据此提示「该号未注册」，否则等于把用户枚举做成了功能。
 * - 验证码校验失败时后端**不消费验证码**，用户可在原地重输，无需重新发码。
 * - 票据一次性消费，有效期由响应里的 `expires_in`（秒）给出，倒计时必须以它初始化。
 * - 改密成功是 204，且该用户 `token_version` 递增 —— 所有设备的既有令牌立即失效，
 *   调用方必须随即清掉本地令牌。
 *
 * 扫码契约要点：
 * - 二维码内容必须原样使用响应里的 `qr_payload`，前端不得自己拼 scheme。
 * - `poll_secret` 只在建会话的响应里出现一次，轮询时必须放进 `X-Qr-Poll-Secret` 请求头；
 *   它不在二维码里，正是「轮询者就是建会话的那一端」的唯一证明。缺失或错误一律 403。
 * - 令牌只能被取走一次，取走即销毁会话；同一个码的第二次轮询是 404。
 */
import { apiPost, request } from "./client";

/** 改密票据：`verifyResetCode` 换回的一次性凭据与其有效期 */
export interface ResetTicket {
  /** 一次性改密票据，交给 `resetPassword` 使用 */
  resetTicket: string;
  /** 票据剩余有效期（秒），由后端下发 */
  expiresIn: number;
}

/** 后端 verify 响应体（snake_case） */
interface ResetTicketDTO {
  reset_ticket: string;
  expires_in: number;
}

/**
 * 下发改密验证码（第 1 步）
 *
 * @param phone - 手机号
 * @remarks 成功为 204 空响应；手机号未注册时响应与已注册完全一致（不下发、不报错）。
 *   60 秒内重发或下发通道故障会抛 `ApiError`。
 */
export async function sendResetCode(phone: string): Promise<void> {
  await apiPost<void>("/api/v1/auth/password/otp", { phone });
}

/**
 * 校验改密验证码并换取票据（第 2 步）
 *
 * @param phone - 第 1 步用的同一手机号
 * @param code - 6 位验证码
 * @returns 一次性票据与其有效期（秒）
 * @remarks 验证码错误抛 `ApiError`，且验证码仍然有效 —— 调用方应让用户原地重输而非重新发码。
 */
export async function verifyResetCode(phone: string, code: string): Promise<ResetTicket> {
  const dto = await apiPost<ResetTicketDTO>("/api/v1/auth/password/verify", { phone, code });
  return { resetTicket: dto.reset_ticket, expiresIn: dto.expires_in };
}

/**
 * 用票据设置新密码（第 3 步）
 *
 * @param resetTicket - 第 2 步换回的票据，一次性消费
 * @param newPassword - 新密码，需过后端复杂度校验
 * @remarks 成功为 204，且该用户所有设备的令牌立即失效；新密码不合复杂度时
 *   `ApiError.message` 是命中规则的 `validation.password*` i18n key，票据不被消费。
 */
export async function resetPassword(resetTicket: string, newPassword: string): Promise<void> {
  await apiPost<void>("/api/v1/auth/password/reset", {
    reset_ticket: resetTicket,
    new_password: newPassword,
  });
}

/** 轮询密钥的请求头名；走请求头而非 query，避免密钥落进服务端 access log */
const POLL_SECRET_HEADER = "X-Qr-Poll-Secret";

/** 扫码会话状态；只能单向前进，`confirmed` 是终态 */
export type QrStatus = "pending" | "scanned" | "confirmed";

/** 扫码会话：被扫端建会话后拿到的全部内容 */
export interface QrSession {
  /** 一次性会话凭据，也是轮询的路径参数 */
  qrToken: string;
  /** 二维码里要编码的串，**原样使用**，不要自己拼 scheme */
  qrPayload: string;
  /** 会话有效期（秒），倒计时以它初始化 */
  expiresIn: number;
  /** 轮询凭据，只在这一次响应里出现；不在二维码里 */
  pollSecret: string;
}

/** 扫码换出的令牌对 */
export interface QrTokens {
  accessToken: string;
  refreshToken: string;
  /** access 令牌寿命（秒）—— 与会话剩余秒数不是一回事 */
  expiresIn: number;
}

/** 一次轮询的结果 */
export interface QrPollResult {
  status: QrStatus;
  /** **会话**剩余存活秒数；`confirmed` 时固定 0（会话已销毁） */
  expiresIn: number;
  /** 仅在 `confirmed` 的那一次出现，取走即销毁会话 */
  tokens?: QrTokens;
}

/** 后端 session 响应体（snake_case） */
interface QrSessionDTO {
  qr_token: string;
  qr_payload: string;
  expires_in: number;
  poll_secret: string;
}

/** 后端 poll 响应体（snake_case） */
interface QrPollDTO {
  status: QrStatus;
  expires_in: number;
  tokens?: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
}

/**
 * 创建扫码登录会话（被扫端）
 *
 * @returns 二维码内容、会话有效期与轮询密钥
 * @remarks 请求体是空对象而不是无 body —— 后端要求该端点必须带 JSON 体，空 body 会得到 400。
 *   平台标识 `device_id` 刻意不传：后端缺省按 `web` 处理，与密码登录链路（服务端固定写 `web`）一致，
 *   避免在共享组件里塞入端判定。
 */
export async function createQrSession(): Promise<QrSession> {
  const dto = await apiPost<QrSessionDTO>("/api/v1/auth/qr/session", {});
  return {
    qrToken: dto.qr_token,
    qrPayload: dto.qr_payload,
    expiresIn: dto.expires_in,
    pollSecret: dto.poll_secret,
  };
}

/**
 * 轮询扫码会话状态（被扫端）
 *
 * @param qrToken - 建会话拿到的会话凭据
 * @param pollSecret - 建会话拿到的轮询密钥，作为 `X-Qr-Poll-Secret` 请求头发出
 * @returns 当前状态与会话剩余秒数；状态为 `confirmed` 时额外带令牌对
 * @remarks 密钥缺失或不匹配抛 403 `auth.qrFailed`；会话不存在、已过期或令牌已被取走抛 404
 *   `auth.qrExpired`。**拿到 `tokens` 后必须停止轮询** —— 会话已被销毁，再轮询只会得到 404。
 */
export async function pollQrSession(qrToken: string, pollSecret: string): Promise<QrPollResult> {
  const dto = await request<QrPollDTO>("/api/v1/auth/qr/" + encodeURIComponent(qrToken), {
    method: "GET",
    headers: { [POLL_SECRET_HEADER]: pollSecret },
  });
  return {
    status: dto.status,
    expiresIn: dto.expires_in,
    tokens: dto.tokens
      ? {
          accessToken: dto.tokens.access_token,
          refreshToken: dto.tokens.refresh_token,
          expiresIn: dto.tokens.expires_in,
        }
      : undefined,
  };
}
