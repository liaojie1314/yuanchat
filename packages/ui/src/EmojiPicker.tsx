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
 * @param compact - 移动端紧凑模式（放大表情、收窄格子）
 */
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { cn } from "@yuanchat/shared/utils";
import { listMyStickers, listStickerPacks, removeSticker, showToast } from "@yuanchat/shared";
import type { StickerItem, StickerPackItem } from "@yuanchat/shared";
import { EMOJI_CATEGORIES } from "./emojiData";
import { StickerThumb } from "./StickerThumb";

/** localStorage key：最近使用 emoji（JSON string[]） */
const RECENT_KEY = "yuanchat-recent-emojis";
/** 最近使用最大保留数量 */
const RECENT_LIMIT = 24;

/** 贴纸列表拉取状态：idle 未发起 / loading 进行中 / done 成功 / error 失败可重试 */
type LoadState = "idle" | "loading" | "done" | "error";

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
  onPickSticker,
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
  compact?: boolean;
  onPickSticker?: (sticker: {
    id: string;
    objectKey: string;
    width: number;
    height: number;
  }) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [recent, setRecent] = useState<string[]>(() => readRecent());
  const tabsRef = useRef<HTMLDivElement>(null);
  const [activeKey, setActiveKey] = useState<string>(EMOJI_CATEGORIES[0].key);
  const [myStickers, setMyStickers] = useState<StickerItem[]>([]);
  const [packs, setPacks] = useState<StickerPackItem[]>([]);
  const [stickerMenuId, setStickerMenuId] = useState<string | null>(null);
  // 收藏 / 官方两个 tab 各自的拉取状态。用显式状态机而非 "list.length === 0" 判断：
  // 后者会把「拉取失败」和「确实没有」混成同一个空白面板，且失败后依赖值不变导致
  // effect 不再重跑（用户必须切走再切回才会重试，而他没理由知道要这么做）。
  const [favState, setFavState] = useState<LoadState>("idle");
  const [packState, setPackState] = useState<LoadState>("idle");
  // 点「重试」时递增，作为 effect 依赖强制重跑
  const [retryTick, setRetryTick] = useState(0);

  const handlePick = (emoji: string) => {
    setRecent((prev) => pushRecent(prev, emoji));
    onPick(emoji);
  };

  // 惰性拉取收藏贴纸（仅在 idle 时发起，避免 setState 触发的重渲染重复请求）
  useEffect(() => {
    if (activeKey !== "favorites" || favState !== "idle") return;
    setFavState("loading");
    listMyStickers()
      .then((list) => {
        setMyStickers(list);
        setFavState("done");
      })
      .catch(() => setFavState("error"));
  }, [activeKey, favState, retryTick]);

  // 惰性拉取官方包
  useEffect(() => {
    if (activeKey !== "official" || packState !== "idle") return;
    setPackState("loading");
    listStickerPacks()
      .then((list) => {
        setPacks(list);
        setPackState("done");
      })
      .catch(() => setPackState("error"));
  }, [activeKey, packState, retryTick]);

  /** 重试当前 tab 的拉取：把状态打回 idle，由 retryTick 驱动 effect 重跑 */
  const retryLoad = () => {
    if (activeKey === "favorites") setFavState("idle");
    else setPackState("idle");
    setRetryTick((n) => n + 1);
  };

  /**
   * 删除收藏贴纸：先本地摘掉（乐观），失败再放回并提示。
   *
   * @remarks 原实现是 `void removeSticker(id).then(refresh)`——`void` 只丢弃返回值
   *   并不捕获 rejection，403/404/500/断网时菜单已关、列表不刷新、贴纸原样留着、
   *   零提示，只在控制台留一条 unhandled rejection；且把「UI 生效」押在第二个网络
   *   请求（refresh）上，refresh 自身失败时已删的贴纸会继续显示，再点一次拿到 404。
   */
  const handleRemove = (id: string) => {
    setStickerMenuId(null);
    const snapshot = myStickers;
    setMyStickers((prev) => prev.filter((s) => s.id !== id));
    void removeSticker(id).catch(() => {
      setMyStickers(snapshot);
      showToast("error", t("sticker.removeFailed"));
    });
  };

  // 点面板外部关闭贴纸删除菜单。注意：根节点的 onMouseDown 会 stopPropagation（连原生
  // 事件一起停），面板内部的点击到不了 document，故内部关闭由根节点 onMouseDown 兼任。
  useEffect(() => {
    if (!stickerMenuId) return;
    const handleClick = () => setStickerMenuId(null);
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [stickerMenuId]);

  // 分类 tab 栏的竖向滚轮转横向滚动。桌面没有触摸滑动，只靠 6px 滚动条很难拖，
  // 不接这一层就等于后面几个分类根本到不了。必须用原生非被动监听：
  // React 的 onWheel 在根节点是 passive 注册，preventDefault 无效。
  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // 切分类后把选中 tab 滚进可视区（键盘 Tab 走焦点、点击走这里）
  useEffect(() => {
    const active = tabsRef.current?.querySelector<HTMLElement>(
      '[role="tab"][aria-selected="true"]',
    );
    // scrollIntoView 不是所有环境都有（jsdom 没实现、老 WebView 也可能缺），
    // 缺了只是少一次滚动，不能让整个面板挂掉
    if (active && typeof active.scrollIntoView === "function") {
      active.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [activeKey]);

  const activeEmojis =
    activeKey === "recent"
      ? recent
      : (EMOJI_CATEGORIES.find((c) => c.key === activeKey)?.emojis ?? []);

  // 官方 tab 聚合全部包的贴纸。用 concat 而非 flatMap：项目 build.target=es2019
  // 且不注入运行时 polyfill，禁用 es2020+ 数组 API（见 browser-compat 约束）。
  const officialStickers = packs.reduce<StickerItem[]>((acc, p) => acc.concat(p.stickers), []);
  const isStickerTab = activeKey === "favorites" || activeKey === "official";
  const gridStickers = activeKey === "favorites" ? myStickers : officialStickers;
  const gridState = activeKey === "favorites" ? favState : packState;

  return (
    <div
      role="dialog"
      aria-label={t("chat.input.emoji")}
      onMouseDown={(e) => {
        // 面板内任意处按下即收起贴纸删除菜单（菜单自身已 stopPropagation，不会自杀）
        setStickerMenuId(null);
        e.stopPropagation();
      }}
      // h-full 是必需的：父容器（Composer）给的是固定高度，缺了它面板会按内容自由生长，
      // 撑破父容器后在手机端直接顶出视口底部（最后一行贴纸点不到，且页面不可滚动）
      className="bg-surface-container-high border-outline-variant flex h-full flex-col overflow-hidden rounded-lg border shadow-lg"
    >
      {/* 分类 tab 栏：固定单行 + 横向滚动。分类多达 9 个，换行会把 tab 栏越撑越高，
          吃掉下方贴纸网格的可用高度（面板总高固定）。滚动条保留可见（全局 6px 细条），
          否则用户看不出后面还有分类 */}
      <div
        role="tablist"
        ref={tabsRef}
        className="border-outline-variant flex shrink-0 gap-0.5 overflow-x-auto border-b px-1.5 pt-1.5 pb-1"
      >
        {onPickSticker && (
          <CategoryTab
            label={t("sticker.tab.favorites")}
            active={activeKey === "favorites"}
            onClick={() => setActiveKey("favorites")}
          />
        )}
        {onPickSticker && (
          <CategoryTab
            label={t("sticker.tab.official")}
            active={activeKey === "official"}
            onClick={() => setActiveKey("official")}
          />
        )}
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

      {/* 贴纸网格（收藏 / 官方）或 emoji 网格 */}
      {isStickerTab ? (
        gridState === "error" ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4">
            <span className="text-body-sm text-on-surface-variant text-center">
              {t("sticker.listFailed")}
            </span>
            <button
              type="button"
              onClick={retryLoad}
              className="text-label-md text-primary hover:bg-surface-container-low rounded-lg px-3 py-1 transition-colors"
            >
              {t("common.retry")}
            </button>
          </div>
        ) : gridState === "done" && gridStickers.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-4">
            <span className="text-body-sm text-on-surface-variant text-center">
              {t(activeKey === "favorites" ? "sticker.emptyFavorites" : "sticker.emptyOfficial")}
            </span>
          </div>
        ) : (
          <div className="grid flex-1 auto-rows-min grid-cols-4 gap-1.5 overflow-y-auto p-1.5">
            {gridState === "loading" &&
              // 骨架占位：数量与列数对齐，避免出图时面板高度跳动
              [0, 1, 2, 3].map((i) => (
                <div
                  key={"skeleton-" + i}
                  className="bg-surface-container-low aspect-square animate-pulse rounded-lg"
                  aria-hidden
                />
              ))}
            {gridStickers.map((st) => (
              <div key={st.id} className="relative">
                <button
                  type="button"
                  // 按钮内只有 alt="" 的 img，无 aria-label 则无可访问名（屏幕阅读器读作空按钮）
                  aria-label={t("sticker.send")}
                  data-sticker-id={st.id}
                  onClick={() =>
                    onPickSticker?.({
                      id: st.id,
                      objectKey: st.object_key,
                      width: st.width,
                      height: st.height,
                    })
                  }
                  onContextMenu={(e) => {
                    if (activeKey !== "favorites") return;
                    e.preventDefault();
                    setStickerMenuId(st.id);
                  }}
                  className="hover:bg-surface-container-low grid aspect-square place-items-center rounded-lg p-1 transition-colors active:scale-90"
                >
                  <StickerThumb objectKey={st.object_key} />
                </button>
                {stickerMenuId === st.id && (
                  <div
                    role="menu"
                    onMouseDown={(e) => e.stopPropagation()}
                    className="bg-surface-container-high border-outline-variant absolute top-full left-0 z-20 mt-1 overflow-hidden rounded-lg border py-1 shadow-lg"
                  >
                    <button
                      role="menuitem"
                      onClick={() => handleRemove(st.id)}
                      className="text-body-md text-error hover:bg-surface-container-highest flex w-full items-center gap-2 px-3 py-2 text-left"
                    >
                      <Trash2 size={14} /> {t("sticker.remove")}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      ) : (
        <div
          className={cn(
            "grid flex-1 gap-0.5 overflow-y-auto p-1.5",
            // 固定格子边长而非按列数等分：等分后每格宽度随面板走
            // （手机满宽 8 列 ≈ 48px 一格），表情只有 20px，格间空档比表情还大，
            // 视觉上散成一片。定长格子 + auto-fill 由宽度决定列数，排布始终紧凑。
            compact
              ? "auto-rows-[2.75rem] grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))]"
              : "auto-rows-[2.25rem] grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))]",
          )}
        >
          {activeEmojis.map((emoji, i) => (
            <button
              key={`${emoji}-${i}`}
              type="button"
              aria-label={emoji}
              onClick={() => handlePick(emoji)}
              className={cn(
                "hover:bg-surface-container-low flex items-center justify-center rounded-lg transition-colors active:scale-90",
                compact ? "text-2xl" : "text-xl",
              )}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {/* 官方 tab 底部：商城入口（面板不挤占 tab，移动端与桌面侧栏之外的第二条路径）。
          useNavigate 需 Router 上下文——本组件只在聊天主界面（Router 内）渲染，
          单测里包 MemoryRouter 即可 */}
      {isStickerTab && activeKey === "official" && (
        <div className="border-outline-variant shrink-0 border-t px-3 py-1.5 text-center">
          <button
            type="button"
            onClick={() => navigate("/stickers")}
            className="text-label-md text-primary hover:bg-surface-container-low rounded-lg px-3 py-1 transition-colors"
          >
            {t("sticker.market.browse")}
          </button>
        </div>
      )}
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
