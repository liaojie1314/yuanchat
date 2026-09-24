/**
 * 用户资料 REST API — 公开资料查询 / 我的资料更新
 *
 * @description 对应后端 GET /users/:id 与 PUT /users/me。
 */
import { apiGet, apiPut } from "./client";

export interface PublicProfile {
  id: string;
  nickname: string;
  avatarUrl?: string | null;
  shortId: number;
  bio?: string | null;
  gender: 0 | 1 | 2;
  /** 个人状态 emoji（K11）；已过期的状态服务端吐空串 */
  statusEmoji: string;
  /** 个人状态文案；已过期的状态服务端吐空串 */
  statusText: string;
}

export interface ProfilePatch {
  nickname?: string;
  avatarUrl?: string;
  bio?: string;
  gender?: 0 | 1 | 2;
  /** 个人状态 emoji，空串表示清除状态 */
  statusEmoji?: string;
  /** 个人状态文案，空串表示清除状态 */
  statusText?: string;
  /** 状态有效秒数；0 表示不自动清除（换算在客户端做，服务端不猜时区） */
  statusDuration?: number;
}

interface UserProfileDTO {
  id: string;
  nickname: string;
  avatar_url?: string | null;
  short_id: number;
  bio?: string | null;
  gender: number;
  status_emoji?: string;
  status_text?: string;
}

function mapProfile(dto: UserProfileDTO): PublicProfile {
  return {
    id: dto.id,
    nickname: dto.nickname,
    avatarUrl: dto.avatar_url,
    shortId: dto.short_id,
    bio: dto.bio,
    gender: (dto.gender === 1 || dto.gender === 2 ? dto.gender : 0) as 0 | 1 | 2,
    statusEmoji: dto.status_emoji ?? "",
    statusText: dto.status_text ?? "",
  };
}

export async function fetchPublicProfile(userId: string): Promise<PublicProfile> {
  return mapProfile(await apiGet<UserProfileDTO>("/api/v1/users/" + encodeURIComponent(userId)));
}

export async function updateMyProfile(patch: ProfilePatch): Promise<PublicProfile> {
  const body: Record<string, unknown> = {};
  if (patch.nickname !== undefined) body.nickname = patch.nickname;
  if (patch.avatarUrl !== undefined) body.avatar_url = patch.avatarUrl;
  if (patch.bio !== undefined) body.bio = patch.bio;
  if (patch.gender !== undefined) body.gender = patch.gender;
  if (patch.statusEmoji !== undefined) body.status_emoji = patch.statusEmoji;
  if (patch.statusText !== undefined) body.status_text = patch.statusText;
  if (patch.statusDuration !== undefined) body.status_duration = patch.statusDuration;
  return mapProfile(await apiPut<UserProfileDTO>("/api/v1/users/me", body));
}
