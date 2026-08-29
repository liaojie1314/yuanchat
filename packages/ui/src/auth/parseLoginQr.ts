/**
 * 扫码登录二维码来源校验
 *
 * @description
 * 单独成文件而不是放在 ScanQrEntry 里：组件文件混着导出纯函数会破坏 React Fast Refresh
 * （eslint react-refresh/only-export-components），而这个函数本身也需要脱离组件独立单测。
 */

/** 扫码登录二维码的固定前缀，与服务端 `qr_payload` 一致 */
const LOGIN_QR_PREFIX = "yuanchat://login?t=";

/**
 * 从二维码内容中取出扫码登录 token
 *
 * @param raw - 原生扫描器返回的原始字符串
 * @returns 会话凭据；非本应用二维码或 token 为空时返回 null
 * @remarks 前缀不匹配一律返回 null —— 调用方据此提示「非本应用二维码」，
 *   绝不能把无法识别的内容当 token 提交给后端。这是「任意二维码不得被当成会话凭据」
 *   这条约束的唯一执行点。
 */
export function parseLoginQr(raw: string): string | null {
  if (!raw.startsWith(LOGIN_QR_PREFIX)) return null;
  const token = raw.slice(LOGIN_QR_PREFIX.length);
  if (token.length === 0) return null;
  return decodeURIComponent(token);
}
