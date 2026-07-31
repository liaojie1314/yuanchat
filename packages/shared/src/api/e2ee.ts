/**
 * E2EE 公钥分发 API（/api/v1/e2ee/*）
 *
 * 服务端只经手公钥与客户端加密好的备份密文。
 */
import { apiGet, apiPost, ApiError } from "./client";

export interface UploadKeysRequest {
  identity_dh_public_key: string;
  identity_sign_public_key: string;
  signed_prekey_id: number;
  signed_prekey_public: string;
  signed_prekey_signature: string;
  one_time_prekeys?: Array<{ key_id: number; public_key: string }>;
}

export interface RemotePreKeyBundle {
  identity_dh_public_key: string;
  identity_sign_public_key: string;
  signed_prekey_id: number;
  signed_prekey_public: string;
  signed_prekey_signature: string;
  one_time_prekey_id?: number;
  one_time_prekey_public?: string;
}

export function uploadKeys(req: UploadKeysRequest) {
  return apiPost<{ uploaded: boolean; one_time_prekeys_remaining: number }>(
    "/api/v1/e2ee/keys",
    req,
  );
}

/**
 * 取对端 prekey bundle。
 * @returns null 表示对方未启用 E2EE（后端 404），调用方应回退明文会话
 */
export async function fetchPreKeyBundle(userId: string): Promise<RemotePreKeyBundle | null> {
  try {
    return await apiGet<RemotePreKeyBundle>(`/api/v1/e2ee/prekey-bundle/${userId}`);
  } catch (err) {
    if (err instanceof ApiError && err.code === 404) return null;
    throw err;
  }
}

export function fetchPreKeyCount() {
  return apiGet<{ remaining: number }>("/api/v1/e2ee/prekey-count");
}

export function saveKeyBackup(cipherBlob: string, salt: string, version = 1) {
  return apiPost<{ saved: boolean; version: number }>("/api/v1/e2ee/backup", {
    cipher_blob: cipherBlob,
    salt,
    version,
  });
}

export interface RemoteKeyBackup {
  cipher_blob: string;
  salt: string;
  version: number;
  updated_at: string;
}

/** 取备份 blob；无备份返回 null */
export async function fetchKeyBackup(): Promise<RemoteKeyBackup | null> {
  try {
    return await apiGet<RemoteKeyBackup>("/api/v1/e2ee/backup");
  } catch (err) {
    if (err instanceof ApiError && err.code === 404) return null;
    throw err;
  }
}
