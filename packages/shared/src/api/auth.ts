/**
 * 认证 REST API — 忘记密码三段式改密
 *
 * @description
 * 对应后端 `POST /auth/password/otp` → `/auth/password/verify` → `/auth/password/reset`。
 * 三条端点均无需鉴权（用户此时正是登不进去才来改密）。
 *
 * 契约要点（由后端实现钉死，前端不得自行加工）：
 * - 发码成功是 204 空响应；**手机号未注册时响应完全相同**，前端因此无法、也绝不能
 *   据此提示「该号未注册」，否则等于把用户枚举做成了功能。
 * - 验证码校验失败时后端**不消费验证码**，用户可在原地重输，无需重新发码。
 * - 票据一次性消费，有效期由响应里的 `expires_in`（秒）给出，倒计时必须以它初始化。
 * - 改密成功是 204，且该用户 `token_version` 递增 —— 所有设备的既有令牌立即失效，
 *   调用方必须随即清掉本地令牌。
 */
import { apiPost } from "./client";

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
