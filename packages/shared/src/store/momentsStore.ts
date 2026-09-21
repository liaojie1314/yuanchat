/**
 * 朋友圈状态管理 Store
 *
 * @description
 * 管理信息流列表 + 互动消息：
 * - posts / nextCursor / hasMore：游标分页，`loadFeed` 重置、`loadMore` 追加
 * - 点赞、删帖、删评论一律乐观更新 + 失败回滚（网络往返期间界面不能发呆）
 * - unreadCount / activities：互动消息红点与列表，WS 帧到达时 `pushActivity`
 *
 * 数据来源：MomentsScreen 挂载时 `loadFeed()`；互动消息走 `moments.activity` 帧增量，
 * 进互动页时以服务端返回的列表为准。
 */
import { create } from "zustand";
import {
  addComment,
  deleteComment,
  deletePost,
  fetchActivities,
  fetchFeed,
  likePost,
  markActivitiesRead,
  unlikePost,
} from "../api/moments";
import type { MomentActivity, MomentPost } from "../api/moments";

interface MomentsState {
  posts: MomentPost[];
  /** 下一页游标；空串表示已到底 */
  nextCursor: string;
  /** 还有下一页（骨架屏与触底加载用） */
  hasMore: boolean;
  /** 列表请求进行中（兼作触底加载的防重复闸门） */
  loading: boolean;
  /** 未读互动数（导航角标与铃铛角标共用） */
  unreadCount: number;
  activities: MomentActivity[];

  /** 拉首页：重置列表与游标 */
  loadFeed: () => Promise<void>;
  /** 触底加载下一页：追加而非覆盖 */
  loadMore: () => Promise<void>;
  /** 点赞/取消点赞：乐观翻转，失败回滚 */
  toggleLike: (postId: string) => Promise<void>;
  /** 评论：成功后把服务端返回的评论追加进该帖 */
  comment: (postId: string, content: string, replyToUserId?: string) => Promise<void>;
  /** 删除动态：乐观摘除，失败回滚并抛错供上层 toast */
  removePost: (postId: string) => Promise<void>;
  /** 删除评论：乐观摘除，失败回滚并抛错 */
  removeComment: (postId: string, commentId: string) => Promise<void>;
  /** 拉互动消息列表（含服务端未读数） */
  loadActivities: () => Promise<void>;
  /** 全部已读：先本地清零（红点消得跟手），失败不回滚——下次拉列表以服务端为准 */
  markRead: () => Promise<void>;
  /** WS 帧到达：未读 +1 且插入列表头部 */
  pushActivity: (activity: MomentActivity) => void;
}

/** 按 id 改写列表中的一条帖子，其余原样返回 */
function patchPost(
  posts: MomentPost[],
  postId: string,
  patch: (p: MomentPost) => MomentPost,
): MomentPost[] {
  return posts.map((p) => (p.id === postId ? patch(p) : p));
}

export const useMomentsStore = create<MomentsState>()((set, get) => ({
  posts: [],
  nextCursor: "",
  hasMore: true,
  loading: false,
  unreadCount: 0,
  activities: [],

  loadFeed: async () => {
    set({ loading: true });
    try {
      const page = await fetchFeed();
      set({
        posts: page.posts,
        nextCursor: page.nextCursor,
        hasMore: page.nextCursor !== "",
        loading: false,
      });
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },

  loadMore: async () => {
    const { loading, hasMore, nextCursor } = get();
    if (loading || !hasMore || nextCursor === "") return;
    set({ loading: true });
    try {
      const page = await fetchFeed(nextCursor);
      set({
        posts: get().posts.concat(page.posts),
        nextCursor: page.nextCursor,
        hasMore: page.nextCursor !== "",
        loading: false,
      });
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },

  toggleLike: async (postId) => {
    const prev = get().posts;
    const target = prev.find((p) => p.id === postId);
    if (!target) return;
    const liked = !target.likedByMe;
    set({
      posts: patchPost(prev, postId, (p) => ({
        ...p,
        likedByMe: liked,
        likeCount: Math.max(0, p.likeCount + (liked ? 1 : -1)),
      })),
    });
    try {
      await (liked ? likePost(postId) : unlikePost(postId));
    } catch {
      // 点赞失败无声回滚：这是低价值动作，弹窗打断不值当，界面复原即已表达失败
      set({ posts: prev });
    }
  },

  comment: async (postId, content, replyToUserId) => {
    const created = await addComment(postId, content, replyToUserId);
    set({
      posts: patchPost(get().posts, postId, (p) => ({
        ...p,
        comments: p.comments.concat([created]),
      })),
    });
  },

  removePost: async (postId) => {
    const prev = get().posts;
    set({ posts: prev.filter((p) => p.id !== postId) });
    try {
      await deletePost(postId);
    } catch (err) {
      set({ posts: prev });
      throw err;
    }
  },

  removeComment: async (postId, commentId) => {
    const prev = get().posts;
    set({
      posts: patchPost(prev, postId, (p) => ({
        ...p,
        comments: p.comments.filter((c) => c.id !== commentId),
      })),
    });
    try {
      await deleteComment(commentId);
    } catch (err) {
      set({ posts: prev });
      throw err;
    }
  },

  loadActivities: async () => {
    set({ loading: true });
    try {
      const page = await fetchActivities();
      set({ activities: page.activities, unreadCount: page.unreadCount, loading: false });
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },

  markRead: async () => {
    if (get().unreadCount === 0) return;
    set({
      unreadCount: 0,
      activities: get().activities.map((a) => ({ ...a, read: true })),
    });
    try {
      await markActivitiesRead();
    } catch {
      // 已读失败不回滚：下次拉列表会以服务端为准，回滚反而让红点闪回
    }
  },

  pushActivity: (activity) => {
    set({
      unreadCount: get().unreadCount + 1,
      activities: [activity].concat(get().activities),
    });
  },
}));
