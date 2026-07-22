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
}

export interface ProfilePatch {
  nickname?: string;
  avatarUrl?: string;
  bio?: string;
  gender?: 0 | 1 | 2;
}

interface UserProfileDTO {
  id: string;
  nickname: string;
  avatar_url?: string | null;
  short_id: number;
  bio?: string | null;
  gender: number;
}

function mapProfile(dto: UserProfileDTO): PublicProfile {
  return {
    id: dto.id,
    nickname: dto.nickname,
    avatarUrl: dto.avatar_url,
    shortId: dto.short_id,
    bio: dto.bio,
    gender: (dto.gender === 1 || dto.gender === 2 ? dto.gender : 0) as 0 | 1 | 2,
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
  return mapProfile(await apiPut<UserProfileDTO>("/api/v1/users/me", body));
}
