/**
 * 贴纸上传辅助 — 发布 / 编辑表情包共用的直传流程
 *
 * @description
 * 复用 H1 的「压缩 → 预签名 → 直传 → 收藏」链路（images 类别），并提供
 * 封面专用通道（sticker-covers 类别，公共读，upload-url 直接返回 publicUrl）：
 * - `uploadAndCollectSticker`：把一张本地图片压缩直传后立即加入本人收藏，
 *   返回新收藏项——发布 / 编辑页的上传来源都经它落地成可勾选的收藏贴纸
 * - `uploadStickerCover`：以某张已有贴纸（images/ 对象）为源，取回字节后
 *   复制一份到 sticker-covers/ 类别，返回封面对象键与宽高
 */
import {
  addSticker,
  compressImage,
  getDownloadUrl,
  getUploadUrl,
  hashBlob,
  uploadToTicket,
} from "@yuanchat/shared";
import type { StickerItem } from "@yuanchat/shared";

/** 贴纸输出最长边：贴纸按小尺寸展示，512 兼顾清晰度与流量 */
const STICKER_MAX_EDGE = 512;

/**
 * 压缩并直传一张贴纸图，成功后收藏并返回新收藏项。
 *
 * @param file - 本地图片（来自 file input；File 携带原始文件名，仅用于服务端
 *   提取扩展名）；gif 原样透传保留动图
 * @throws 任一环节失败（压缩/签名/直传/收藏）时抛出，由调用方提示后重试
 */
export async function uploadAndCollectSticker(file: File): Promise<StickerItem> {
  const compressed = await compressImage(file, STICKER_MAX_EDGE);
  const contentHash = await hashBlob(compressed.blob);
  const contentType = compressed.blob.type || "image/png";
  const ticket = await getUploadUrl(
    file.name || "sticker.png",
    contentType,
    compressed.blob.size,
    "images",
  );
  await uploadToTicket(ticket, compressed.blob, contentType);
  return addSticker(ticket.objectKey, compressed.width, compressed.height, contentHash);
}

/**
 * 把一张已有贴纸复制为表情包封面（sticker-covers/ 公共读类别）。
 *
 * @param objectKey - 源贴纸对象键（images/ 前缀）
 * @param width - 源贴纸像素宽（封面与贴纸同源同尺寸，服务端不落库仅回传展示）
 * @param height - 源贴纸像素高
 * @returns 封面对象键与宽高；封面公共 URL 由服务端从对象键推导，前端无需自行拼接
 * @throws 源对象取回失败 / 签名失败 / 直传失败时抛出
 */
export async function uploadStickerCover(
  objectKey: string,
  width: number,
  height: number,
): Promise<{ objectKey: string; width: number; height: number }> {
  const url = await getDownloadUrl(objectKey);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("cover source fetch failed: HTTP " + res.status);
  }
  const blob = await res.blob();
  const contentType = blob.type || "image/png";
  // 服务端 upload-url 只用文件名提取扩展名；沿用源贴纸的扩展名最稳
  const dot = objectKey.lastIndexOf(".");
  const ext = dot >= 0 ? objectKey.slice(dot) : ".png";
  const ticket = await getUploadUrl("cover" + ext, contentType, blob.size, "sticker-covers");
  await uploadToTicket(ticket, blob, contentType);
  return { objectKey: ticket.objectKey, width, height };
}
