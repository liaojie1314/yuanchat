/**
 * 通话文案格式化 — 时长与通话记录 i18n key
 *
 * @description
 * 抽成独立模块而非写在 `CallView` 里，是因为通话记录气泡（`MessageBubble`）
 * 与通话界面的计时器要用同一套口径 —— 两处各写一份 `mm:ss` 是「气泡显示 3:24、
 * 界面显示 03:24」这类不一致的来源。
 */

/**
 * 把秒数格式化为 `mm:ss`（满一小时给 `h:mm:ss`）。
 *
 * @param sec - 秒数；负数 / NaN / Infinity 一律按 0 处理（元数据不可读时不显示 NaN）
 * @example formatCallDuration(204) // "03:24"
 * @example formatCallDuration(3725) // "1:02:05"
 */
export function formatCallDuration(sec: number): string {
  const safe = isFinite(sec) && sec > 0 ? Math.floor(sec) : 0;
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  const mm = (h > 0 && m < 10 ? "0" : "") + String(m);
  const pad2 = (n: number) => (n < 10 ? "0" : "") + String(n);
  if (h > 0) return String(h) + ":" + mm + ":" + pad2(s);
  return pad2(m) + ":" + pad2(s);
}

/**
 * 通话记录 `result` → i18n key。
 *
 * @param result - 服务端推导的结果：`answered` / `missed` / `rejected` /
 *   `canceled` / `busy`
 * @returns 对应文案 key；未知值回落到 `canceled`
 * @remarks 绝不返回空串：未知 result 若上屏为空白，气泡就是一个无法解释的空胶囊，
 *   而「已取消」至少语义正确 —— 任何非 answered 的结果都是「没打成」。
 */
export function callRecordKey(result: string): string {
  if (result === "answered") return "call.record.answered";
  if (result === "missed") return "call.record.missed";
  if (result === "rejected") return "call.record.rejected";
  if (result === "busy") return "call.record.busy";
  return "call.record.canceled";
}
