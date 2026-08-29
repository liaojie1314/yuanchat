/**
 * 认证错误 → i18n key 映射
 *
 * @description
 * 后端统一响应壳把业务错误信息放在 `message` 里，且 `message` 本身就是 i18n key
 * （例如 `auth.otpWrong`、`validation.passwordUppercase`），`code` 只是 HTTP 状态码。
 * 因此映射的输入是 `message` 而不是 `code`。
 *
 * 两件事必须在这里收口，不能散落到各个屏：
 * 1. **白名单**。限流中间件返回的 `message` 是一句裸英文（不是 i18n key），
 *    直接交给 `t()` 会把英文原文上屏、且绕开 i18n 约束；网络异常更没有 message 可用。
 *    只有白名单内的 key 允许透传，其余一律回落到调用方给的兜底 key。
 * 2. **两种 429**。账号/试错锁定是 `429 + auth.accountLocked`，IP 限流是
 *    `429 + 裸英文`；后者统一显示通用限流文案。
 */
import { ApiError } from "@yuanchat/shared";

/**
 * 后端可能直接回给前端的 i18n key 白名单
 *
 * 改密链路的错误 key + 密码复杂度六条规则（后端把命中规则的 key 放进 message）。
 */
const PASSTHROUGH_KEYS = new Set([
  "auth.otpRequired",
  "auth.otpWrong",
  "auth.sendFailed",
  "auth.resetFailed",
  "auth.accountLocked",
  "validation.passwordMinLength",
  "validation.passwordMaxLength",
  "validation.passwordNoWhitespace",
  "validation.passwordLowercase",
  "validation.passwordUppercase",
  "validation.passwordDigit",
]);

/** 账号/试错锁定的判据：429 里只有这个 message 表示锁定，其余 429 都是 IP 限流 */
const LOCKED_KEY = "auth.accountLocked";

/**
 * 把接口错误翻成可以交给 `t()` 的 i18n key
 *
 * @param err - `catch` 到的异常，通常是 `ApiError`
 * @param fallbackKey - 未知错误（网络异常、非白名单 message）时使用的兜底 key
 * @returns i18n key
 *
 * @example
 * setOtpError(t(mapAuthError(e, "auth.otpWrong")));
 */
export function mapAuthError(err: unknown, fallbackKey: string): string {
  if (!(err instanceof ApiError)) return fallbackKey;
  if (err.code === 429) {
    return err.message === LOCKED_KEY ? LOCKED_KEY : "auth.rateLimited";
  }
  return PASSTHROUGH_KEYS.has(err.message) ? err.message : fallbackKey;
}
