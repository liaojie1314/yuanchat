/**
 * 举报 API — POST /api/v1/reports
 */
import { apiPost } from "./client";

export async function reportMessage(
  messageId: string,
  reason = "",
): Promise<{ id: string; status: number }> {
  return apiPost("/api/v1/reports", {
    target_type: "message",
    target_id: messageId,
    reason,
  });
}

export async function reportUser(
  userId: string,
  reason = "",
): Promise<{ id: string; status: number }> {
  return apiPost("/api/v1/reports", {
    target_type: "user",
    target_id: userId,
    reason,
  });
}

/** 举报一个表情包（admin 处置后下架该包）。 */
export async function reportStickerPack(
  packId: string,
  reason = "",
): Promise<{ id: string; status: number }> {
  return apiPost("/api/v1/reports", {
    target_type: "sticker_pack",
    target_id: packId,
    reason,
  });
}
