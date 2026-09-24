/**
 * MomentsScreen 组件 — 朋友圈信息流
 *
 * @description
 * 三端同构的一屏编排：顶栏（标题 + 互动铃铛 + 发布入口）+ 帖子列表 + 触底续页。
 * 四态齐全：骨架（首屏加载）/ 空态 / 错误态+重试 / 正常。
 *
 * 两种数据源共用同一套渲染：
 * - 信息流（`/moments`）走 {@link useMomentsStore}，WS 互动帧要就地更新它
 * - 个人页（`/moments/user/:userId`）走一次性分页拉取的本地列表，属临时视图，
 *   退出即弃，不污染信息流缓存
 *
 * 删帖走 {@link ConfirmDialog} 二次确认：{@link MomentPostCard} 的 `onDelete`
 * 是直接回调、不自带确认，而删帖不可撤销，与删好友/清空记录同级。
 *
 * @param userId - 非空即个人页模式，只看这个人的动态
 */
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Bell, Images, PenSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  addComment,
  captureException,
  deletePost,
  fetchUserPosts,
  likePost,
  showToast,
  unlikePost,
  useMomentsStore,
} from "@yuanchat/shared";
import type { MomentPost } from "@yuanchat/shared";
import { ConfirmDialog } from "../primitives/ConfirmDialog";
import { MomentPostCard } from "./MomentPostCard";

/** 距底多少像素开始拉下一页 */
const LOAD_MORE_PX = 200;
/** 首屏骨架卡数量 */
const SKELETON_CARDS = 3;

/** 列表数据源：信息流与个人页各一份实现，接口一致故渲染只写一遍 */
interface FeedSource {
  posts: MomentPost[];
  loading: boolean;
  hasMore: boolean;
  /** 拉第一页（挂载与重试） */
  load: () => Promise<void>;
  /** 触底续页 */
  loadMore: () => Promise<void>;
  like: (postId: string) => void;
  comment: (postId: string, content: string, replyToUserId?: string) => Promise<void>;
  remove: (postId: string) => Promise<void>;
}

/**
 * 按是否个人页挑数据源。
 *
 * @remarks 两条分支的 hook 都在分支前调完，故 early return 不违反 hooks 规则。
 *   个人页的乐观更新与 store 同口径（先改本地、失败复原），只是落在本地 state。
 */
function useFeedSource(userId?: string): FeedSource {
  const store = useMomentsStore();
  const [posts, setPosts] = useState<MomentPost[]>([]);
  const [cursor, setCursor] = useState("");
  const [loading, setLoading] = useState(false);

  if (!userId) {
    return {
      posts: store.posts,
      loading: store.loading,
      hasMore: store.hasMore,
      load: store.loadFeed,
      loadMore: store.loadMore,
      like: store.toggleLike,
      comment: store.comment,
      remove: store.removePost,
    };
  }

  const patch = (id: string, fn: (p: MomentPost) => MomentPost) =>
    setPosts((prev) => prev.map((p) => (p.id === id ? fn(p) : p)));

  return {
    posts,
    loading,
    hasMore: cursor !== "",
    load: async () => {
      setLoading(true);
      try {
        const page = await fetchUserPosts(userId);
        setPosts(page.posts);
        setCursor(page.nextCursor);
      } finally {
        setLoading(false);
      }
    },
    loadMore: async () => {
      if (loading || cursor === "") return;
      setLoading(true);
      try {
        const page = await fetchUserPosts(userId, cursor);
        setPosts((prev) => prev.concat(page.posts));
        setCursor(page.nextCursor);
      } finally {
        setLoading(false);
      }
    },
    like: (postId) => {
      const target = posts.find((p) => p.id === postId);
      if (!target) return;
      const liked = !target.likedByMe;
      const snapshot = posts;
      patch(postId, (p) => ({
        ...p,
        likedByMe: liked,
        likeCount: Math.max(0, p.likeCount + (liked ? 1 : -1)),
      }));
      void (liked ? likePost(postId) : unlikePost(postId)).catch(() => setPosts(snapshot));
    },
    comment: async (postId, content, replyToUserId) => {
      const created = await addComment(postId, content, replyToUserId);
      patch(postId, (p) => ({ ...p, comments: p.comments.concat([created]) }));
    },
    remove: async (postId) => {
      await deletePost(postId);
      setPosts((prev) => prev.filter((p) => p.id !== postId));
    },
  };
}

/** 骨架卡：高度固定，出真实帖子时不撑动列表（CLS 0） */
function MomentSkeleton() {
  return (
    <div
      data-testid="moment-skeleton"
      aria-hidden
      className="border-outline-variant flex h-[132px] gap-3 border-b px-4 py-4"
    >
      <div className="bg-surface-container-high h-10 w-10 shrink-0 animate-pulse rounded-full" />
      <div className="flex-1 space-y-2">
        <div className="bg-surface-container-high h-4 w-24 animate-pulse rounded-lg" />
        <div className="bg-surface-container-high h-3 w-full animate-pulse rounded-lg" />
        <div className="bg-surface-container-high h-3 w-2/3 animate-pulse rounded-lg" />
      </div>
    </div>
  );
}

export function MomentsScreen({ userId }: { userId?: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const unreadCount = useMomentsStore((s) => s.unreadCount);
  const feed = useFeedSource(userId);
  const [failed, setFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 挂载 / 换人 / 重试时拉第一页；数据源对象每次渲染重建，故依赖只钉触发条件
  useEffect(() => {
    setFailed(false);
    void feed.load().catch((err: unknown) => {
      captureException(err, { context: "MomentsScreen.load" });
      setFailed(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, retryTick]);

  /** 触底续页：加载中 / 无更多 / 错误态时不触发 */
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el || feed.loading || failed || !feed.hasMore) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < LOAD_MORE_PX) {
      void feed.loadMore().catch(() => showToast("error", t("moments.loadFailed")));
    }
  };

  const confirmDelete = async () => {
    const id = pendingDelete;
    setPendingDelete(null);
    if (!id) return;
    try {
      await feed.remove(id);
    } catch (err) {
      captureException(err, { context: "MomentsScreen.remove" });
      showToast("error", t("common.opFailed"));
    }
  };

  const firstLoad = feed.loading && feed.posts.length === 0;
  const peerName = feed.posts.length > 0 ? feed.posts[0].user.nickname : "";

  return (
    <div className="flex h-full flex-col">
      <header className="border-outline-variant bg-surface-container-low flex h-[60px] shrink-0 items-center gap-2 border-b px-3">
        {userId ? (
          <button
            type="button"
            onClick={() => navigate("/moments")}
            aria-label={t("chat.back")}
            className="md3-icon-btn text-on-surface"
          >
            <ArrowLeft size={20} />
          </button>
        ) : null}
        <h1 className="text-title-md text-on-surface min-w-0 flex-1 truncate font-semibold">
          {userId && peerName ? peerName : t("moments.title")}
        </h1>
        {userId ? null : (
          <>
            <button
              type="button"
              onClick={() => navigate("/moments/activities")}
              aria-label={t("moments.activities")}
              className="md3-icon-btn text-on-surface-variant relative"
            >
              <Bell size={20} />
              {unreadCount > 0 && (
                <span
                  data-testid="moments-unread"
                  className="text-label-sm absolute top-0 right-0 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 font-bold text-white"
                >
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => navigate("/moments/compose")}
              aria-label={t("moments.publish")}
              className="md3-icon-btn text-on-surface-variant"
            >
              <PenSquare size={20} />
            </button>
          </>
        )}
      </header>

      <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto">
        {failed ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-sm">
            <p className="text-on-surface-variant">{t("moments.loadFailed")}</p>
            <button
              type="button"
              onClick={() => setRetryTick((n) => n + 1)}
              className="text-primary rounded-lg px-3 py-1 transition-colors hover:opacity-80"
            >
              {t("common.retry")}
            </button>
          </div>
        ) : firstLoad ? (
          Array.from({ length: SKELETON_CARDS }, (_, i) => <MomentSkeleton key={i} />)
        ) : feed.posts.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-sm">
            <Images size={32} className="text-on-surface-variant opacity-30" />
            <p className="text-on-surface-variant">{t("moments.empty")}</p>
            {userId ? null : (
              <button
                type="button"
                onClick={() => navigate("/moments/compose")}
                className="bg-primary text-on-primary text-label-lg rounded-lg px-4 py-2 font-medium transition-opacity hover:opacity-90"
              >
                {t("moments.postFirst")}
              </button>
            )}
          </div>
        ) : (
          <>
            {feed.posts.map((post) => (
              <MomentPostCard
                key={post.id}
                post={post}
                onLike={feed.like}
                onComment={(postId, content, replyToUserId) =>
                  void feed.comment(postId, content, replyToUserId).catch((err: unknown) => {
                    captureException(err, { context: "MomentsScreen.comment" });
                    showToast("error", t("common.opFailed"));
                  })
                }
                onDelete={setPendingDelete}
                onOpenUser={(uid) => navigate("/moments/user/" + uid)}
              />
            ))}
            {/* 续页指示不占固定高度，避免自己把触底判定撑走 */}
            {feed.loading && (
              <p className="text-label-md text-on-surface-variant py-3 text-center">
                {t("common.loading")}
              </p>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        danger
        title={t("common.delete")}
        message={t("moments.deleteConfirm")}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
