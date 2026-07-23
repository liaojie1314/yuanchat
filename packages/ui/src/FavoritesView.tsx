/**
 * FavoritesView — 我的收藏页面
 *
 * @description
 * 展示当前用户收藏的消息列表，支持按类型标签页筛选（全部/文字/图片/文件）。
 * 点击"删除"按钮取消收藏，长列表支持翻页加载。
 */
import { useCallback, useEffect, useState } from "react";
import { FileText, Image, Loader2, MessageSquare, Star, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { captureException, listFavorites, removeFavorite, showToast } from "@yuanchat/shared";
import type { FavoriteItem } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";

type TabType = 0 | 1 | 2 | 3; // 0=全部 1=文字 2=图片 3=文件

/** 解析收藏 content JSON，返回可显示的摘要文本。 */
function parseExcerpt(item: FavoriteItem): string {
  try {
    const c = JSON.parse(item.content) as Record<string, unknown>;
    if (typeof c.text === "string") return c.text.slice(0, 80);
    if (typeof c.name === "string") return c.name;
    if (typeof c.key === "string") return "[media]";
  } catch {
    // content 非合法 JSON 时静默忽略
  }
  return "";
}

/** 消息类型 → 图标组件。 */
function TypeIcon({ type }: { type: number }) {
  if (type === 2) return <Image size={16} className="shrink-0 text-blue-400" />;
  if (type === 3) return <FileText size={16} className="shrink-0 text-orange-400" />;
  return <MessageSquare size={16} className="shrink-0 text-gray-400" />;
}

export function FavoritesView() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabType>(0);
  const [items, setItems] = useState<FavoriteItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  const load = useCallback(
    async (reset = false) => {
      if (loading) return;
      setLoading(true);
      try {
        const res = await listFavorites({
          before: reset ? undefined : cursor,
          limit: 20,
          type: tab || undefined,
        });
        setItems((prev) => (reset ? res.favorites : [...prev, ...res.favorites]));
        setHasMore(res.has_more);
        const last = res.favorites[res.favorites.length - 1];
        setCursor(last ? last.created_at : undefined);
      } catch (err) {
        captureException(err, { context: "FavoritesView.load" });
        showToast("error", t("favorites.loadFailed"));
      } finally {
        setLoading(false);
      }
    },

    [loading, cursor, tab, t],
  );

  // tab 切换时重置列表
  useEffect(() => {
    setCursor(undefined);
    setItems([]);
    setHasMore(false);
    void (async () => {
      setLoading(true);
      try {
        const res = await listFavorites({ limit: 20, type: tab || undefined });
        setItems(res.favorites);
        setHasMore(res.has_more);
        const last = res.favorites[res.favorites.length - 1];
        setCursor(last ? last.created_at : undefined);
      } catch (err) {
        captureException(err, { context: "FavoritesView.tabChange" });
        showToast("error", t("favorites.loadFailed"));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const handleRemove = async (messageId: string) => {
    try {
      await removeFavorite(messageId);
      setItems((prev) => prev.filter((f) => f.message_id !== messageId));
      showToast("info", t("favorites.removed"));
    } catch (err) {
      captureException(err, { context: "FavoritesView.remove" });
      showToast("error", t("favorites.removeFailed"));
    }
  };

  const TABS: { type: TabType; labelKey: string }[] = [
    { type: 0, labelKey: "favorites.all" },
    { type: 1, labelKey: "favorites.text" },
    { type: 2, labelKey: "favorites.image" },
    { type: 3, labelKey: "favorites.file" },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* 页头 */}
      <header className="border-outline-variant bg-surface-container-low flex h-[60px] shrink-0 items-center gap-2 border-b px-4">
        <Star size={20} className="text-primary shrink-0" />
        <h1 className="text-title-md text-on-surface font-semibold">{t("favorites.title")}</h1>
      </header>

      {/* 类型标签页 */}
      <div className="border-outline-variant flex shrink-0 gap-1 border-b px-3 pt-2 pb-0">
        {TABS.map(({ type, labelKey }) => (
          <button
            key={type}
            onClick={() => setTab(type)}
            className={cn(
              "rounded-t-lg px-3 py-1.5 text-sm font-medium transition-colors",
              tab === type
                ? "bg-primary-container text-primary border-primary border-b-2"
                : "text-on-surface-variant hover:bg-surface-container",
            )}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>

      {/* 列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && items.length === 0 && (
          <div className="flex h-32 items-center justify-center">
            <Loader2 size={20} className="text-primary animate-spin" />
          </div>
        )}

        {!loading && items.length === 0 && (
          <div className="flex h-48 flex-col items-center justify-center gap-2 text-sm text-gray-400">
            <Star size={32} className="opacity-30" />
            <p>{t("favorites.empty")}</p>
          </div>
        )}

        <ul className="divide-outline-variant divide-y">
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-3 px-4 py-3">
              <TypeIcon type={item.message_type} />
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 flex items-center gap-1.5">
                  <span className="truncate text-xs font-medium text-gray-500">
                    {item.conv_name}
                  </span>
                  <span className="text-xs text-gray-400">·</span>
                  <span className="truncate text-xs text-gray-400">{item.sender_nickname}</span>
                </div>
                <p className="text-on-surface line-clamp-2 text-sm">{parseExcerpt(item)}</p>
              </div>
              <button
                onClick={() => void handleRemove(item.message_id)}
                aria-label={t("favorites.remove")}
                className="shrink-0 rounded-lg p-1 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>

        {hasMore && (
          <div className="flex justify-center py-3">
            <button
              onClick={() => void load()}
              disabled={loading}
              className="text-primary text-sm disabled:opacity-50"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : t("common.loadMore")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
