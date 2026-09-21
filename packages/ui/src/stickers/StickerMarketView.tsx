/**
 * StickerMarketView 页面 — 表情商城（浏览全站公开表情包）
 *
 * @description
 * 路由 `/stickers` 的实现（两端 app 各自包一层 page 壳）：
 * - 包卡片网格：封面 + 名称 + 发布者 + 贴纸数 + 已添加角标，点击进入包详情
 * - 游标分页 +「加载更多」按钮（照 FavoritesView 范式；无下一页时按钮隐藏）
 * - 首屏加载用卡片网格骨架（固定宽高，CLS=0），空态/错误态 + 重试
 * - 页头提供「我发布的」「发布表情包」两个次级入口
 *
 * 发布者展示规则：owner_name 有值显示「由 %{name} 发布」；为 null 时按
 * is_official 区分「官方出品」与「已注销用户」。
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Loader2, PackageOpen, Sticker } from "lucide-react";
import { captureException, listMarketPacks, showToast, useBreakpoint } from "@yuanchat/shared";
import { useBackTo } from "../util/useBackTo";
import type { MarketPackItem } from "@yuanchat/shared";
import { StickerPackCover } from "./StickerPackCover";
import { packOwnerText } from "./stickerPackUtils";

/** 首屏/翻页每页条数（服务端上限 50，20 与 favorites 页大小对齐） */
const PAGE_SIZE = 20;

/** 列表拉取状态：loading 首屏进行中 / done 成功 / error 失败可重试 */
type LoadState = "loading" | "done" | "error";

/** 每页骨架卡片数：与常见一页的卡片数对齐，避免首屏内容远多于占位时的跳动 */
const SKELETON_COUNT = 8;

/** 单个包卡片：整卡可点进入详情；added 角标盖在封面右上 */
function MarketCard({ pack }: { pack: MarketPackItem }) {
  const { t } = useTranslation();
  return (
    <Link
      to={"/stickers/" + pack.id}
      className="bg-surface-container-low shadow-elevation-1 hover:shadow-elevation-2 relative block overflow-hidden rounded-lg transition-all hover:-translate-y-0.5"
    >
      <div className="relative">
        <StickerPackCover coverUrl={pack.cover_url} fallbackKey={pack.first_sticker_key} />
        <span className="bg-surface-container-high/80 text-on-surface-variant text-label-sm absolute bottom-1.5 left-1.5 rounded-full px-1.5 py-0.5 tabular-nums">
          {pack.sticker_count}
        </span>
      </div>
      {pack.added && (
        <span className="bg-primary text-on-primary text-label-sm absolute top-1.5 right-1.5 rounded-full px-2 py-0.5 font-medium">
          {t("sticker.market.added")}
        </span>
      )}
      <div className="p-2">
        <p className="text-body-md text-on-surface truncate font-medium">{pack.name}</p>
        <p className="text-body-sm text-on-surface-variant mt-0.5 truncate">
          {packOwnerText(pack, t)}
        </p>
      </div>
    </Link>
  );
}

/** 骨架卡片：固定宽高比占位，网格列数变化时不产生布局偏移 */
function MarketSkeleton() {
  return (
    <div aria-hidden>
      <div className="bg-surface-container-high aspect-square w-full animate-pulse rounded-lg" />
      <div className="bg-surface-container-high mt-2 h-4 w-3/4 animate-pulse rounded" />
      <div className="bg-surface-container-high mt-1.5 h-3 w-1/2 animate-pulse rounded" />
    </div>
  );
}

export function StickerMarketView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useBreakpoint() === "mobile";
  // 入口带 from（设置/收藏/聊天进入时写入）：返回箭头与系统返回键都回来源 tab
  const fromTab = (location.state as { from?: string } | null)?.from;
  const backTarget =
    fromTab && ["/chat", "/contacts", "/favorites", "/settings"].includes(fromTab)
      ? fromTab
      : "/chat";
  useBackTo(backTarget);
  const [packs, setPacks] = useState<MarketPackItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  // 点「重试」时递增，驱动首屏 effect 重跑
  const [retryTick, setRetryTick] = useState(0);

  const loadFirstPage = useCallback(async () => {
    setState("loading");
    try {
      const page = await listMarketPacks({ limit: PAGE_SIZE });
      setPacks(page.packs);
      setNextCursor(page.nextCursor);
      setState("done");
    } catch (err) {
      captureException(err, { context: "StickerMarketView.load" });
      setState("error");
    }
  }, []);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage, retryTick]);

  /** 翻页：追加到已加载列表；失败保留原列表并提示（用户可再点「加载更多」） */
  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await listMarketPacks({ cursor: nextCursor, limit: PAGE_SIZE });
      setPacks((prev) => prev.concat(page.packs));
      setNextCursor(page.nextCursor);
    } catch (err) {
      captureException(err, { context: "StickerMarketView.loadMore" });
      showToast("error", t("sticker.market.loadFailed"));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* 页头 */}
      <header className="border-outline-variant bg-surface-container-low flex h-[60px] shrink-0 items-center gap-2 border-b px-4">
        {isMobile && fromTab ? (
          <button
            type="button"
            onClick={() => navigate(backTarget)}
            aria-label={t("sticker.market.back")}
            className="text-on-surface hover:bg-surface-container -ml-1 rounded-lg p-1.5 transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
        ) : (
          <Sticker size={20} className="text-primary shrink-0" />
        )}
        <h1 className="text-title-md text-on-surface font-semibold">{t("sticker.market.title")}</h1>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => navigate("/stickers/mine")}
          className="text-label-lg text-on-surface-variant hover:bg-surface-container rounded-lg px-3 py-1.5 transition-colors"
        >
          {t("sticker.market.myPacks")}
        </button>
        <button
          type="button"
          onClick={() => navigate("/stickers/publish")}
          className="bg-primary text-on-primary text-label-lg rounded-lg px-3 py-1.5 font-medium transition-opacity hover:opacity-90"
        >
          {t("sticker.market.publish")}
        </button>
      </header>

      {/* 列表主体 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {state === "loading" && (
          <div
            className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-3 p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
            data-testid="market-skeleton"
          >
            {Array.from({ length: SKELETON_COUNT }, (_, i) => (
              <MarketSkeleton key={i} />
            ))}
          </div>
        )}

        {state === "error" && (
          <div className="flex h-64 flex-col items-center justify-center gap-2 text-sm">
            <PackageOpen size={32} className="text-on-surface-variant opacity-30" />
            <p className="text-on-surface-variant">{t("sticker.market.loadFailed")}</p>
            <button
              type="button"
              onClick={() => setRetryTick((n) => n + 1)}
              className="text-primary rounded-lg px-3 py-1 transition-colors hover:opacity-80"
            >
              {t("common.retry")}
            </button>
          </div>
        )}

        {state === "done" && packs.length === 0 && (
          <div className="flex h-64 flex-col items-center justify-center gap-2 text-sm">
            <Sticker size={32} className="text-on-surface-variant opacity-30" />
            <p className="text-on-surface-variant">{t("sticker.market.empty")}</p>
          </div>
        )}

        {state === "done" && packs.length > 0 && (
          <>
            <div className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-3 p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {packs.map((pack) => (
                <MarketCard key={pack.id} pack={pack} />
              ))}
            </div>
            {nextCursor && (
              <div className="flex justify-center pt-1 pb-4">
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  className="text-primary text-sm disabled:opacity-50"
                >
                  {loadingMore ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    t("common.loadMore")
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
