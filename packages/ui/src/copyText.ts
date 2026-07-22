/**
 * 剪贴板复制助手（跨 WebView 降级）
 *
 * @description
 * 优先使用 `navigator.clipboard.writeText`；旧 WebView 无该 API 时降级到
 * `document.execCommand("copy")`。设置页、好友资料页等复制场景共用。
 */

/**
 * 复制文本到剪贴板，旧 WebView 无 navigator.clipboard 时降级到 execCommand。
 */
export function copyText(text: string): Promise<void> {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  // 旧 WebView 降级
  const ta = document.createElement("textarea");
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
  return Promise.resolve();
}
