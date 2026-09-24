/**
 * 朋友圈 REST API — 发布 / 信息流 / 点赞 / 评论 / 互动消息
 *
 * @description
 * 命名转换在本层完成：后端 snake_case → 前端 camelCase，组件层只见 camelCase
 * （与 `users.ts` 的 `mapProfile` 同惯例）。
 *
 * 媒体字段出的是对象 key 而非签好名的 URL：调用方拿到 key 后走
 * `getDownloadUrl`（files.ts，带进程内签名缓存）换预签名 GET。
 * 服务端不逐帖签名——一页 20 帖 × 9 图会是 180 次签名。
 */
import { apiDelete, apiGet, apiPost } from "./client";

/** 帖子媒体项：图片只有 key/w/h，视频另带 thumbKey/duration。 */
export interface MomentMediaItem {
  key: string;
  thumbKey?: string;
  duration?: number;
  w: number;
  h: number;
}

/** 帖子/评论/互动里内嵌的用户摘要。 */
export interface MomentUser {
  id: string;
  nickname: string;
  avatarUrl: string;
  /** 个人状态 emoji，已过期的状态服务端吐空串 */
  statusEmoji: string;
}

/** 帖子下的一条评论；`replyToUser` 非空表示「回复某人」。 */
export interface MomentComment {
  id: string;
  user: MomentUser;
  replyToUser: MomentUser | null;
  content: string;
  createdAt: string;
}

/** 0=无媒体 1=图片 2=视频 */
export type MomentMediaKind = 0 | 1 | 2;
/** 0=好友可见 1=仅自己 */
export type MomentVisibility = 0 | 1;

/** 一条动态。 */
export interface MomentPost {
  id: string;
  user: MomentUser;
  content: string;
  mediaKind: MomentMediaKind;
  media: MomentMediaItem[];
  visibility: MomentVisibility;
  likeCount: number;
  likedByMe: boolean;
  likes: MomentUser[];
  comments: MomentComment[];
  createdAt: string;
  /** 本人可删（本人帖）——由服务端判定，前端不自行推导 */
  deletable: boolean;
}

/** 1=点赞 2=评论 */
export type MomentActivityKind = 1 | 2;

/** 一条互动消息（别人赞了/评论了我的动态）。 */
export interface MomentActivity {
  id: string;
  kind: MomentActivityKind;
  postId: string;
  actor: MomentUser;
  commentPreview: string;
  postPreview: string;
  postThumbKey: string;
  read: boolean;
  createdAt: string;
}

// ========================================
// DTO 与映射（逐字对应后端 json tag）
// ========================================

interface MomentUserDTO {
  id: string;
  nickname: string;
  avatar_url: string;
  status_emoji: string;
}

interface MomentMediaItemDTO {
  key: string;
  thumb_key?: string;
  duration?: number;
  w: number;
  h: number;
}

interface MomentCommentDTO {
  id: string;
  user: MomentUserDTO;
  reply_to_user: MomentUserDTO | null;
  content: string;
  created_at: string;
}

interface MomentPostDTO {
  id: string;
  user: MomentUserDTO;
  content: string;
  media_kind: number;
  media: MomentMediaItemDTO[] | null;
  visibility: number;
  like_count: number;
  liked_by_me: boolean;
  likes: MomentUserDTO[] | null;
  comments: MomentCommentDTO[] | null;
  created_at: string;
  deletable: boolean;
}

interface MomentActivityDTO {
  id: string;
  kind: number;
  post_id: string;
  actor: MomentUserDTO;
  comment_preview: string;
  post_preview: string;
  post_thumb_key: string;
  read: boolean;
  created_at: string;
}

interface FeedPageDTO {
  posts: MomentPostDTO[] | null;
  next_cursor: string;
}

interface ActivityPageDTO {
  activities: MomentActivityDTO[] | null;
  unread_count: number;
  next_cursor: string;
}

function mapUser(d: MomentUserDTO): MomentUser {
  return { id: d.id, nickname: d.nickname, avatarUrl: d.avatar_url, statusEmoji: d.status_emoji };
}

/** `thumb_key` → `thumbKey` 必须映射，漏了视频封面拿不到 */
function mapMedia(d: MomentMediaItemDTO): MomentMediaItem {
  return { key: d.key, thumbKey: d.thumb_key, duration: d.duration, w: d.w, h: d.h };
}

function mapComment(d: MomentCommentDTO): MomentComment {
  return {
    id: d.id,
    user: mapUser(d.user),
    replyToUser: d.reply_to_user ? mapUser(d.reply_to_user) : null,
    content: d.content,
    createdAt: d.created_at,
  };
}

function mapPost(d: MomentPostDTO): MomentPost {
  return {
    id: d.id,
    user: mapUser(d.user),
    content: d.content,
    mediaKind: (d.media_kind === 1 || d.media_kind === 2 ? d.media_kind : 0) as MomentMediaKind,
    media: (d.media || []).map(mapMedia),
    visibility: (d.visibility === 1 ? 1 : 0) as MomentVisibility,
    likeCount: d.like_count,
    likedByMe: d.liked_by_me,
    likes: (d.likes || []).map(mapUser),
    comments: (d.comments || []).map(mapComment),
    createdAt: d.created_at,
    deletable: d.deletable,
  };
}

function mapActivity(d: MomentActivityDTO): MomentActivity {
  return {
    id: d.id,
    kind: (d.kind === 1 ? 1 : 2) as MomentActivityKind,
    postId: d.post_id,
    actor: mapUser(d.actor),
    commentPreview: d.comment_preview,
    postPreview: d.post_preview,
    postThumbKey: d.post_thumb_key,
    read: d.read,
    createdAt: d.created_at,
  };
}

/** 媒体项回传后端时转回 snake_case（`thumb_key` 同理，缺省项不下发） */
function toMediaDTO(m: MomentMediaItem): MomentMediaItemDTO {
  const dto: MomentMediaItemDTO = { key: m.key, w: m.w, h: m.h };
  if (m.thumbKey) dto.thumb_key = m.thumbKey;
  if (m.duration) dto.duration = m.duration;
  return dto;
}

/** 游标拼查询串：空游标不带参数，服务端按首页处理 */
function cursorQuery(cursor?: string): string {
  return cursor ? "?cursor=" + encodeURIComponent(cursor) : "";
}

// ========================================
// 端点
// ========================================

/** 发布一条动态。 */
export async function createPost(input: {
  content: string;
  media: MomentMediaItem[];
  mediaKind: MomentMediaKind;
  visibility: MomentVisibility;
}): Promise<MomentPost> {
  return mapPost(
    await apiPost<MomentPostDTO>("/api/v1/moments", {
      content: input.content,
      media: input.media.map(toMediaDTO),
      media_kind: input.mediaKind,
      visibility: input.visibility,
    }),
  );
}

/** 信息流一页（我 + 好友的可见动态，按时间倒序）。 */
export async function fetchFeed(
  cursor?: string,
): Promise<{ posts: MomentPost[]; nextCursor: string }> {
  const dto = await apiGet<FeedPageDTO>("/api/v1/moments/feed" + cursorQuery(cursor));
  return { posts: (dto.posts || []).map(mapPost), nextCursor: dto.next_cursor };
}

/** 某人主页的动态一页。 */
export async function fetchUserPosts(
  userId: string,
  cursor?: string,
): Promise<{ posts: MomentPost[]; nextCursor: string }> {
  const dto = await apiGet<FeedPageDTO>(
    "/api/v1/moments/user/" + encodeURIComponent(userId) + cursorQuery(cursor),
  );
  return { posts: (dto.posts || []).map(mapPost), nextCursor: dto.next_cursor };
}

/** 单条动态详情。 */
export async function fetchPost(id: string): Promise<MomentPost> {
  return mapPost(await apiGet<MomentPostDTO>("/api/v1/moments/" + encodeURIComponent(id)));
}

/** 删除自己的动态（软删，互动一并在读路径过滤）。 */
export async function deletePost(id: string): Promise<void> {
  await apiDelete<unknown>("/api/v1/moments/" + encodeURIComponent(id));
}

/** 点赞。 */
export async function likePost(id: string): Promise<void> {
  await apiPost<unknown>("/api/v1/moments/" + encodeURIComponent(id) + "/like", {});
}

/** 取消点赞。 */
export async function unlikePost(id: string): Promise<void> {
  await apiDelete<unknown>("/api/v1/moments/" + encodeURIComponent(id) + "/like");
}

/** 发表评论；`replyToUserId` 非空即「回复某人」。 */
export async function addComment(
  postId: string,
  content: string,
  replyToUserId?: string,
): Promise<MomentComment> {
  const body: Record<string, unknown> = { content };
  if (replyToUserId) body.reply_to_user_id = replyToUserId;
  return mapComment(
    await apiPost<MomentCommentDTO>(
      "/api/v1/moments/" + encodeURIComponent(postId) + "/comments",
      body,
    ),
  );
}

/** 删除评论（本人评论或本人帖下的评论，由服务端判权）。 */
export async function deleteComment(commentId: string): Promise<void> {
  await apiDelete<unknown>("/api/v1/moments/comments/" + encodeURIComponent(commentId));
}

/** 互动消息一页，附带当前未读数。 */
export async function fetchActivities(
  cursor?: string,
): Promise<{ activities: MomentActivity[]; unreadCount: number; nextCursor: string }> {
  const dto = await apiGet<ActivityPageDTO>("/api/v1/moments/activities" + cursorQuery(cursor));
  return {
    activities: (dto.activities || []).map(mapActivity),
    unreadCount: dto.unread_count,
    nextCursor: dto.next_cursor,
  };
}

/** 标记互动消息已读；不传 ids 表示全部已读。 */
export async function markActivitiesRead(ids?: string[]): Promise<void> {
  await apiPost<unknown>("/api/v1/moments/activities/read", ids ? { ids } : {});
}
