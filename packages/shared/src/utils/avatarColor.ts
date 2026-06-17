/**
 * 头像背景色生成器 — 基于用户名哈希的稳定随机色
 *
 * @description
 * 从预定义的调色板中根据用户名哈希选取颜色，保证：
 * - 同一用户始终获得相同颜色
 * - 颜色在亮/暗主题下均正常显示
 * - 白色首字母文字与背景有足够对比度
 * - 相邻用户颜色足够分散，易于视觉区分
 *
 * 调色板选取原则：
 * - 中等亮度 + 中高饱和度 — 不刺眼也不沉闷
 * - 在深色/浅色背景上都清晰可辨
 * - 避开各皮肤主题的主色，避免"融入主题"的错觉
 *
 * @example
 * getAvatarColor("张三");  // "#4A90D9"
 * getAvatarColor("李四");  // "#E85D75"
 */

/** 头像调色板 — 16 色，间距均匀，适配所有主题 */
const AVATAR_COLORS: string[] = [
  "#4A90D9", // 蓝
  "#E85D75", // 珊瑚红
  "#9B59B6", // 紫
  "#2ECC71", // 翠绿
  "#F39C12", // 橙
  "#1ABC9C", // 青绿
  "#E74C3C", // 朱红
  "#3498DB", // 天蓝
  "#E91E63", // 粉红
  "#00BCD4", // 青
  "#8BC34A", // 草绿
  "#FF9800", // 琥珀
  "#7C4DFF", // 深紫
  "#00BFA5", // 薄荷
  "#FF6D00", // 深橙
  "#2979FF", // 亮蓝
];

/**
 * 简单的字符串哈希函数（djb2 变体）
 *
 * @description
 * 将任意字符串映射为 32 位整数，分布均匀，碰撞率低。
 * 用于从调色板中确定性选取颜色。
 *
 * @param str - 输入字符串（通常是用户名）
 * @returns 非负整数哈希值
 */
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0; // 保持 32 位
  }
  return Math.abs(hash);
}

/**
 * 根据用户名获取固定的头像背景色
 *
 * @param name - 用户名（用于哈希计算）
 * @returns 十六进制颜色字符串，如 "#4A90D9"
 *
 * @example
 * getAvatarColor("王小明");  // 始终返回同一颜色
 */
export function getAvatarColor(name: string): string {
  if (!name) return AVATAR_COLORS[0];
  const index = hashString(name) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index];
}
