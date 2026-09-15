/**
 * 表情包文案辅助 — 商城列表 / 详情页共用的发布者展示规则
 */

/**
 * 发布者文案：owner_name 有值显示「由 %{name} 发布」；为 null 时按
 * is_official 区分「官方出品」与「已注销用户」。
 *
 * @param pack - 携带 owner_name 与 is_official 的包摘要/详情
 * @param t - react-i18next 的翻译函数（由调用方注入，保持本函数可单测）
 */
export function packOwnerText(
  pack: { owner_name?: string | null; is_official: boolean },
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (pack.owner_name) return t("sticker.market.byUser", { name: pack.owner_name });
  return pack.is_official ? t("sticker.market.byOfficial") : t("sticker.market.deletedUser");
}
