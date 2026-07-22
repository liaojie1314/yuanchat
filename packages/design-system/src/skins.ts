/**
 * 元聊 YuanChat — 皮肤/主题系统
 *
 * @description
 * 基于 M3 颜色方案的可扩展皮肤架构。
 * 每个皮肤是一组 M3ColorScheme + 元数据。
 * 支持自定义皮肤注入，所有会话实时响应主题切换。
 *
 * 架构设计：
 * - SkinDefinition：皮肤的定义接口，第三方可通过插件形式注入
 * - builtInSkins：内置皮肤列表
 * - SkinStore：Zustand 管理当前皮肤和所有注册皮肤
 */

import type { M3ColorScheme } from "./tokens";
import { lightScheme, darkScheme } from "./tokens";

// ========================================
// 皮肤定义
// ========================================

/** 皮肤定义接口 */
export interface SkinDefinition {
  /** 唯一标识 */
  id: string;
  /** 显示名称（i18n key） */
  nameKey: string;
  /** 皮肤模式 */
  mode: "light" | "dark";
  /** 是否为内置皮肤 */
  builtIn: boolean;
  /** 预览色（用于皮肤选择器展示） */
  previewColors: string[];
  /** M3 颜色方案 */
  scheme: M3ColorScheme;
}

// ========================================
// 内置皮肤
// ========================================

/** 内置亮色皮肤 — 元聊蓝紫（默认） */
const defaultLight: SkinDefinition = {
  id: "yuan-light",
  nameKey: "skin.yuanLight",
  mode: "light",
  builtIn: true,
  previewColors: ["#4a5cc4", "#5b5d72", "#75546f", "#fefbff", "#e3e1ec"],
  scheme: lightScheme,
};

/** 内置暗色皮肤 — 元聊暗紫 */
const defaultDark: SkinDefinition = {
  id: "yuan-dark",
  nameKey: "skin.yuanDark",
  mode: "dark",
  builtIn: true,
  previewColors: ["#b8c4ff", "#c4c5dd", "#e5bad8", "#131318", "#46464f"],
  scheme: darkScheme,
};

/** 亮色皮肤 — 海洋蓝 */
const oceanLight: SkinDefinition = {
  id: "ocean-light",
  nameKey: "skin.oceanLight",
  mode: "light",
  builtIn: true,
  previewColors: ["#00658a", "#4a616c", "#3b6472", "#f6fafe", "#dae5ed"],
  scheme: {
    ...lightScheme,
    primary: "#00658a",
    onPrimary: "#ffffff",
    primaryContainer: "#c3e7ff",
    onPrimaryContainer: "#001e2d",
  },
};

/** 暗色皮肤 — 海洋暗 */
const oceanDark: SkinDefinition = {
  id: "ocean-dark",
  nameKey: "skin.oceanDark",
  mode: "dark",
  builtIn: true,
  previewColors: ["#8bcef1", "#b2c4cf", "#b6cad4", "#171c1f", "#41484d"],
  scheme: {
    ...darkScheme,
    primary: "#8bcef1",
    onPrimary: "#003547",
    primaryContainer: "#004c68",
    onPrimaryContainer: "#c3e7ff",
  },
};

/** 亮色皮肤 — 森林绿 */
const forestLight: SkinDefinition = {
  id: "forest-light",
  nameKey: "skin.forestLight",
  mode: "light",
  builtIn: true,
  previewColors: ["#386a20", "#59604e", "#3c693a", "#f8fdf2", "#dbe7cf"],
  scheme: {
    ...lightScheme,
    primary: "#386a20",
    onPrimary: "#ffffff",
    primaryContainer: "#b8f295",
    onPrimaryContainer: "#072100",
  },
};

/** 暗色皮肤 — 森林暗 */
const forestDark: SkinDefinition = {
  id: "forest-dark",
  nameKey: "skin.forestDark",
  mode: "dark",
  builtIn: true,
  previewColors: ["#9dd67b", "#c1cbaf", "#a5d497", "#1a1c17", "#43483e"],
  scheme: {
    ...darkScheme,
    primary: "#9dd67b",
    onPrimary: "#163800",
    primaryContainer: "#25500b",
    onPrimaryContainer: "#b8f295",
  },
};

// ========================================
// 皮肤注册表
// ========================================

/** 所有已注册的皮肤 */
export const builtInSkins: SkinDefinition[] = [
  defaultLight,
  defaultDark,
  oceanLight,
  oceanDark,
  forestLight,
  forestDark,
];

/** 注册自定义皮肤（插件/扩展使用） */
export function registerSkin(skin: SkinDefinition): void {
  const idx = builtInSkins.findIndex((s) => s.id === skin.id);
  if (idx >= 0) {
    builtInSkins[idx] = skin;
  } else {
    builtInSkins.push(skin);
  }
}

/** 根据 ID 查找皮肤 */
export function findSkin(id: string): SkinDefinition | undefined {
  return builtInSkins.find((s) => s.id === id);
}

/** 获取默认皮肤（亮色模式） */
export function getDefaultSkin(): SkinDefinition {
  return defaultLight;
}
