/**
 * EmojiPicker 组件 — 表情选择面板
 *
 * @description
 * 分类 emoji 选择器，供 Composer 弹出使用：
 * - 顶部分类 tab（含“最近使用”动态分类，无记录时隐藏）
 * - 网格展示当前分类 emoji，点击触发 onPick 并写入最近使用
 * - 最近使用持久化在 localStorage（头插去重、上限 24），读写均 try/catch 兜底
 *
 * 布局由父组件（Composer）决定：桌面浮层 / 移动端行内推高。
 * 根元素 onMouseDown 阻止冒泡，配合 Composer 的 document 监听实现“点外部关闭”。
 *
 * @param onPick - 选中回调，参数为原生 emoji 字符
 * @param onClose - 关闭回调（预留给父层，如需在选后关闭）
 * @param compact - 移动端紧凑模式（收窄网格间距）
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@yuanchat/shared/utils";
import { EMOJI_CATEGORIES } from "./emojiData";

/** localStorage key：最近使用 emoji（JSON string[]） */
const RECENT_KEY = "yuanchat-recent-emojis";
/** 最近使用最大保留数量 */
const RECENT_LIMIT = 24;

/** 读取最近使用列表，异常时返回空数组 */
function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((e): e is string => typeof e === "string") : [];
  } catch {
    return [];
  }
}

/** 头插去重、截断至上限后写回 localStorage，异常静默忽略 */
function pushRecent(prev: string[], emoji: string): string[] {
  const next = [emoji, ...prev.filter((e) => e !== emoji)].slice(0, RECENT_LIMIT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // localStorage 不可用（隐私模式 / 配额）时忽略，仅内存生效
  }
  return next;
}

export function EmojiPicker({
  onPick,
  onClose: _onClose,
  compact = false,
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const [recent, setRecent] = useState<string[]>(() => readRecent());
  const [activeKey, setActiveKey] = useState<string>(EMOJI_CATEGORIES[0].key);

  const handlePick = (emoji: string) => {
    setRecent((prev) => pushRecent(prev, emoji));
    onPick(emoji);
  };

  const activeEmojis =
    activeKey === "recent"
      ? recent
      : (EMOJI_CATEGORIES.find((c) => c.key === activeKey)?.emojis ?? []);

  return (
    <div
      role="dialog"
      aria-label={t("chat.input.emoji")}
      onMouseDown={(e) => e.stopPropagation()}
      className="bg-surface-container-high border-outline-variant flex flex-col overflow-hidden rounded-xl border shadow-lg"
    >
      {/* 分类 tab 栏 */}
      <div
        role="tablist"
        className="border-outline-variant flex shrink-0 gap-0.5 overflow-x-auto border-b px-1.5 py-1.5"
      >
        {recent.length > 0 && (
          <CategoryTab
            label={t("chat.emoji.recent")}
            active={activeKey === "recent"}
            onClick={() => setActiveKey("recent")}
          />
        )}
        {EMOJI_CATEGORIES.map((cat) => (
          <CategoryTab
            key={cat.key}
            label={t(cat.labelKey)}
            active={activeKey === cat.key}
            onClick={() => setActiveKey(cat.key)}
          />
        ))}
      </div>

      {/* emoji 网格 */}
      <div
        className={cn(
          "grid flex-1 auto-rows-min grid-cols-8 overflow-y-auto p-1.5",
          compact ? "gap-0.5" : "gap-1",
        )}
      >
        {activeEmojis.map((emoji, i) => (
          <button
            key={`${emoji}-${i}`}
            type="button"
            aria-label={emoji}
            onClick={() => handlePick(emoji)}
            className="hover:bg-surface-container-low grid aspect-square place-items-center rounded-lg text-xl transition-colors active:scale-90"
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 单个分类 tab，选中态高亮 */
function CategoryTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "text-label-sm shrink-0 rounded-lg px-2.5 py-1 whitespace-nowrap transition-colors",
        active
          ? "bg-surface-container-low text-on-surface font-medium"
          : "text-on-surface-variant hover:text-on-surface",
      )}
    >
      {label}
    </button>
  );
}
