/**
 * 群管理 REST API — 改名 / 邀请 / 踢人 / 退群 / 解散。
 * 成功后列表态统一由 WS 帧（conversation.updated / removed / message.receive[system]）驱动，
 * 此处不做本地乐观更新（与撤回同构，保证多端一致）。
 */
import { apiDelete, apiPatch, apiPost } from "./client";

export async function renameGroup(convId: string, name: string): Promise<void> {
  await apiPatch<{ name: string }>("/api/v1/conversations/" + convId, { name });
}

export async function inviteMembers(convId: string, memberIds: string[]): Promise<void> {
  await apiPost<{ member_count: number }>("/api/v1/conversations/" + convId + "/members", {
    member_ids: memberIds,
  });
}

export async function kickMember(convId: string, userId: string): Promise<void> {
  await apiDelete<Record<string, never>>("/api/v1/conversations/" + convId + "/members/" + userId);
}

export async function leaveGroup(convId: string): Promise<void> {
  await apiPost<Record<string, never>>("/api/v1/conversations/" + convId + "/leave", {});
}

export async function dissolveGroup(convId: string): Promise<void> {
  await apiDelete<Record<string, never>>("/api/v1/conversations/" + convId);
}

export async function appointAdmin(convId: string, userId: string): Promise<void> {
  await apiPost<{ user_id: string; new_role: number }>(
    "/api/v1/conversations/" + convId + "/admins",
    { user_id: userId },
  );
}

export async function revokeAdmin(convId: string, userId: string): Promise<void> {
  await apiDelete<{ user_id: string; new_role: number }>(
    "/api/v1/conversations/" + convId + "/admins/" + userId,
  );
}

export async function transferOwner(convId: string, newOwnerId: string): Promise<void> {
  await apiPost<{ old_owner_id: string; new_owner_id: string }>(
    "/api/v1/conversations/" + convId + "/owner-transfer",
    { new_owner_id: newOwnerId },
  );
}
