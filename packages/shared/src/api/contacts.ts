/**
 * 联系人 REST API — 搜索 / 好友申请 / 好友列表 / 删好友 / 黑名单 + DTO 映射
 *
 * @description
 * 对应后端 `server/internal/handler/{contact,blocklist}.go`：
 * - GET    /api/v1/users/search?q=            精确搜索（手机号/元聊号/邮箱）
 * - POST   /api/v1/contacts/requests          发起申请
 * - GET    /api/v1/contacts/requests          申请列表（收到 + 发出）
 * - POST   /api/v1/contacts/requests/:id/accept
 * - POST   /api/v1/contacts/requests/:id/reject
 * - GET    /api/v1/contacts                   好友列表（含单聊会话 ID）
 * - DELETE /api/v1/contacts/:id               删除好友（双向）
 * - GET    /api/v1/blocks                     黑名单列表
 * - POST   /api/v1/blocks                     拉黑
 * - DELETE /api/v1/blocks/:targetId           解除拉黑
 */
import { apiDelete, apiGet, apiPost } from "./client";

// ========================================
// 前端模型
// ========================================

/** 用户与当前用户的关系 */
export type ContactRelation = "none" | "friend" | "pending_out" | "pending_in" | "self";

/** 搜索结果 / 帧内的用户摘要 */
export interface ContactUser {
  id: string;
  nickname: string;
  avatarUrl?: string | null;
  shortId: number;
}

export interface SearchUserResult {
  user: ContactUser;
  relation: ContactRelation;
}

/** 好友（列表项） */
export interface Friend extends ContactUser {
  /** 与该好友的单聊会话 ID（accept 时必建；历史脏数据可能为 null） */
  conversationId: string | null;
}

/** 好友申请状态：0 pending / 1 accepted / 2 rejected */
export type FriendRequestStatus = 0 | 1 | 2;

export interface FriendRequestItem {
  id: string;
  /** in = 我收到的 / out = 我发出的 */
  direction: "in" | "out";
  status: FriendRequestStatus;
  message: string;
  /** 对方（direction=in 时是 requester，out 时是 target） */
  peer: ContactUser;
  updatedAt: string;
}

// ========================================
// 后端 DTO
// ========================================

interface UserBriefDTO {
  id: string;
  nickname: string;
  avatar_url?: string | null;
  short_id: number;
}

interface FriendDTO {
  user_id: string;
  nickname: string;
  avatar_url?: string | null;
  short_id: number;
  conversation_id?: string | null;
}

interface RequestDTO {
  id: string;
  direction: "in" | "out";
  status: number;
  message: string;
  requester: UserBriefDTO;
  target: UserBriefDTO;
  created_at: string;
  updated_at: string;
}

function mapUserBrief(dto: UserBriefDTO): ContactUser {
  return {
    id: dto.id,
    nickname: dto.nickname,
    avatarUrl: dto.avatar_url,
    shortId: dto.short_id,
  };
}

export function mapFriend(dto: FriendDTO): Friend {
  return {
    id: dto.user_id,
    nickname: dto.nickname,
    avatarUrl: dto.avatar_url,
    shortId: dto.short_id,
    conversationId: dto.conversation_id ?? null,
  };
}

export function mapRequest(dto: RequestDTO): FriendRequestItem {
  return {
    id: dto.id,
    direction: dto.direction,
    status: dto.status as FriendRequestStatus,
    message: dto.message,
    peer: mapUserBrief(dto.direction === "in" ? dto.requester : dto.target),
    updatedAt: dto.updated_at,
  };
}

// ========================================
// API 调用
// ========================================

export async function searchUser(q: string): Promise<SearchUserResult> {
  const data = await apiGet<{ user: UserBriefDTO; relation: ContactRelation }>(
    "/api/v1/users/search?q=" + encodeURIComponent(q),
  );
  return { user: mapUserBrief(data.user), relation: data.relation };
}

export async function sendFriendRequest(targetId: string, message: string): Promise<void> {
  await apiPost("/api/v1/contacts/requests", { target_id: targetId, message });
}

export async function listFriendRequests(): Promise<FriendRequestItem[]> {
  const data = await apiGet<{ requests: RequestDTO[] }>("/api/v1/contacts/requests");
  return (data.requests || []).map(mapRequest);
}

export async function acceptFriendRequest(requestId: string): Promise<string> {
  const data = await apiPost<{ conversation_id: string }>(
    "/api/v1/contacts/requests/" + requestId + "/accept",
    {},
  );
  return data.conversation_id;
}

export async function rejectFriendRequest(requestId: string): Promise<void> {
  await apiPost("/api/v1/contacts/requests/" + requestId + "/reject", {});
}

export async function fetchFriends(): Promise<Friend[]> {
  const data = await apiGet<{ friends: FriendDTO[] }>("/api/v1/contacts");
  return (data.friends || []).map(mapFriend);
}

/** 删除好友（双向解除关系；单聊会话与历史保留，由 WS friend.removed 帧驱动双端清理） */
export async function deleteFriend(friendId: string): Promise<void> {
  await apiDelete("/api/v1/contacts/" + friendId);
}

// ========================================
// 黑名单
// ========================================

/** 黑名单条目（后端已 join 用户资料） */
export interface BlockedUser {
  targetId: string;
  nickname: string;
  avatarUrl?: string | null;
  shortId: number;
  createdAt: number;
}

interface BlockedUserDTO {
  target_id: string;
  nickname: string;
  avatar_url?: string | null;
  short_id: number;
  created_at: number;
}

export function mapBlockedUser(dto: BlockedUserDTO): BlockedUser {
  return {
    targetId: dto.target_id,
    nickname: dto.nickname,
    avatarUrl: dto.avatar_url,
    shortId: dto.short_id,
    createdAt: dto.created_at,
  };
}

export async function listBlocked(): Promise<BlockedUser[]> {
  const data = await apiGet<{ items: BlockedUserDTO[] }>("/api/v1/blocks");
  return (data.items || []).map(mapBlockedUser);
}

/** 拉黑目标用户（幂等） */
export async function blockUser(targetId: string): Promise<void> {
  await apiPost("/api/v1/blocks", { target_id: targetId });
}

/** 解除拉黑（幂等） */
export async function unblockUser(targetId: string): Promise<void> {
  await apiDelete("/api/v1/blocks/" + targetId);
}
