/**
 * 文件直传 REST API — 预签名上传/下载 + 客户端图片压缩
 *
 * @description
 * 对象存储采用「服务端签发预签名 URL、客户端直传」模式，服务端不中转字节：
 * - `getUploadUrl` 拿到 PUT 直传票据（uploadUrl + objectKey，头像另附 publicUrl）
 * - `uploadToTicket` 用票据 PUT 原始 blob 到对象存储
 * - `getDownloadUrl` 换取预签名 GET URL，带进程内缓存（提前 5 分钟过期重取），
 *   避免同一张图在消息流反复渲染时重复签名
 * - `compressImage` 发送前在 canvas 上等比缩到最长边 2560，降体积；gif 原样透传（保留动图）
 * - `cropAvatar` 头像专用：中心裁方 + 缩到 512 方图，统一编码 jpeg（动图转静态）
 *
 * 兼容性：产物经 es2019 转译；createImageBitmap 在 Chrome 74 WebView 可用，
 * 不可用时回退 new Image() + objectURL。
 */
import { apiGet, apiPost } from "./client";

/** 预签名上传票据：客户端凭 uploadUrl PUT 直传，objectKey 用于后续 message.send / 下载 */
export interface UploadTicket {
  uploadUrl: string;
  objectKey: string;
  /** 仅头像类别（avatars）返回：匿名公共读地址，无需再签下载 */
  publicUrl?: string;
}

interface UploadUrlDTO {
  upload_url: string;
  object_key: string;
  public_url?: string;
  expires_in: number;
}

/**
 * 申请一个预签名上传 URL。
 *
 * @param filename - 原始文件名（仅用于服务端提取扩展名，最终 objectKey 用 uuid）
 * @param contentType - MIME，须在服务端白名单内（image/jpeg|png|gif|webp）
 * @param size - 字节大小，超过服务端上限回 4002
 * @param category - 显式类别；avatars 走匿名公共读（返回 publicUrl），缺省按 contentType 推断
 * @throws ApiError 4001 类型/扩展名非法 · 4002 超大 · 503 存储不可达
 */
export async function getUploadUrl(
  filename: string,
  contentType: string,
  size: number,
  category?: "images" | "avatars",
): Promise<UploadTicket> {
  const path =
    "/api/v1/files/upload-url" + (category ? "?category=" + encodeURIComponent(category) : "");
  const dto = await apiPost<UploadUrlDTO>(path, {
    filename,
    content_type: contentType,
    size,
  });
  return {
    uploadUrl: dto.upload_url,
    objectKey: dto.object_key,
    publicUrl: dto.public_url,
  };
}

/**
 * 用票据把 blob 直传到对象存储（PUT 预签名 URL）。
 *
 * @remarks 直传对象存储、不走后端信封，故手写 fetch 而非 apiPut；
 *   Content-Type 必须与签名时一致，否则 MinIO 校验签名失败。
 * @throws Error 非 2xx 时抛出（上传失败，调用方置消息为 failed）
 */
export async function uploadToTicket(
  ticket: UploadTicket,
  blob: Blob,
  contentType: string,
): Promise<void> {
  const res = await fetch(ticket.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: blob,
  });
  if (!res.ok) {
    throw new Error("upload failed: HTTP " + res.status);
  }
}

// ========================================
// 下载 URL 缓存
// ========================================

interface DownloadUrlDTO {
  url: string;
  expires_in: number;
}

interface CacheEntry {
  url: string;
  /** epoch ms：过缓存视为失效需重取（已减去提前量） */
  expiresAt: number;
}

/** objectKey → 预签名下载 URL 缓存（进程内，模块级） */
const downloadCache = new Map<string, CacheEntry>();

/** 提前过期量：在服务端 TTL 到期前 5 分钟就重取，规避「拿到即失效」的边界 */
const EARLY_EXPIRE_MS = 5 * 60 * 1000;

/** 测试辅助：清空下载 URL 缓存 */
export function __resetDownloadUrlCache(): void {
  downloadCache.clear();
}

/**
 * 换取对象的预签名下载 URL，带进程内缓存。
 *
 * @remarks 同一张图在消息流会被反复渲染，缓存避免重复签名请求；
 *   缓存条目在服务端 TTL 到期前 5 分钟即失效重取，防止渲染时正好过期。
 */
export async function getDownloadUrl(key: string): Promise<string> {
  const hit = downloadCache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.url;
  }
  const dto = await apiGet<DownloadUrlDTO>(
    "/api/v1/files/download-url?key=" + encodeURIComponent(key),
  );
  const ttlMs = Math.max(0, dto.expires_in * 1000 - EARLY_EXPIRE_MS);
  downloadCache.set(key, { url: dto.url, expiresAt: Date.now() + ttlMs });
  return dto.url;
}

// ========================================
// 客户端图片压缩
// ========================================

/** 压缩输出：blob + 像素宽高（宽高供气泡等比占位，避免图片加载完成前的布局跳动） */
export interface CompressedImage {
  blob: Blob;
  width: number;
  height: number;
}

/** canvas 默认最长边（超过则等比缩小），2560 兼顾清晰度与体积 */
const DEFAULT_MAX_EDGE = 2560;

/** 压缩输出 MIME：png 保持 png（canvas 重编码保留 alpha），其余统一 jpeg */
export function outputTypeFor(mime: string): string {
  return mime === "image/png" ? "image/png" : "image/jpeg";
}

/**
 * 发送前压缩图片：等比缩到最长边 ≤ maxEdge，png 保持 png（保 alpha），其余编码 jpeg（质量 0.85）。
 *
 * @param file - 原始图片 blob（来自 file input / 剪贴板）
 * @param maxEdge - 最长边像素上限，默认 2560
 * @returns 压缩后的 blob 与像素宽高
 * @remarks
 * - gif 原样透传：canvas 会丢弃动图帧，故不压缩，宽高经一次解码读取
 * - 解码优先 createImageBitmap（Chrome 74+ 支持）；不可用时回退 Image + objectURL
 * - canvas/toBlob 任一失败时回退返回原 blob（宁可传原图也不阻塞发送）
 */
export async function compressImage(
  file: Blob,
  maxEdge: number = DEFAULT_MAX_EDGE,
): Promise<CompressedImage> {
  const isGif = file.type === "image/gif";
  const bitmap = await decode(file);
  const srcW = bitmap.width;
  const srcH = bitmap.height;

  // gif 原样透传（保留动图），仅回读宽高
  if (isGif) {
    dispose(bitmap);
    return { blob: file, width: srcW, height: srcH };
  }

  const longest = Math.max(srcW, srcH);
  const scale = longest > maxEdge ? maxEdge / longest : 1;
  const outW = Math.max(1, Math.round(srcW * scale));
  const outH = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    dispose(bitmap);
    return { blob: file, width: srcW, height: srcH };
  }
  ctx.drawImage(bitmap, 0, 0, outW, outH);
  dispose(bitmap);

  const blob = await canvasToBlob(canvas, outputTypeFor(file.type), 0.85);
  // toBlob 失败（极少数环境）回退原图，宽高仍用压缩后的目标尺寸
  return { blob: blob ?? file, width: outW, height: outH };
}

/** 解码为可绘制源：优先 createImageBitmap，回退 Image + objectURL */
async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file);
  }
  const url = URL.createObjectURL(file);
  try {
    return await loadImage(url);
  } finally {
    // Image 已完成 decode，objectURL 可安全释放
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = url;
  });
}

/** 释放 ImageBitmap 占用（HTMLImageElement 无需释放） */
function dispose(src: ImageBitmap | HTMLImageElement): void {
  if (typeof ImageBitmap !== "undefined" && src instanceof ImageBitmap) {
    src.close();
  }
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), type, quality);
  });
}

// ========================================
// 头像裁剪（中心裁方 + 缩放到目标边）
// ========================================

/** 头像默认输出边长（正方形像素），512 兼顾清晰度与体积 */
const AVATAR_EDGE = 512;

/** 中心裁方几何解：从 srcW×srcH 取短边居中正方形，输出边不超过 target（不放大） */
export interface CropRect {
  /** 源图裁剪起点 X（整数像素） */
  sx: number;
  /** 源图裁剪起点 Y（整数像素） */
  sy: number;
  /** 源图裁剪边长（短边） */
  side: number;
  /** 输出边长（= min(side, target)，不放大小图） */
  out: number;
}

/**
 * 计算中心裁方矩形（纯几何，无 canvas 依赖，便于单测）。
 *
 * @param srcW - 源图宽（像素）
 * @param srcH - 源图高（像素）
 * @param target - 目标输出边长上限；源短边小于它时按短边输出（不放大）
 * @returns 源裁剪起点/边长与输出边长
 * @remarks 起点用 floor 取整，避免 drawImage 拿到亚像素源坐标产生边缘模糊
 */
export function centerSquareCrop(srcW: number, srcH: number, target: number): CropRect {
  const side = Math.min(srcW, srcH);
  return {
    sx: Math.floor((srcW - side) / 2),
    sy: Math.floor((srcH - side) / 2),
    side,
    out: Math.min(side, target),
  };
}

/**
 * 头像专用裁剪：解码 → 中心裁方 → 缩到 512 方图 → 编码 jpeg（质量 0.85）。
 *
 * @param file - 原始图片 blob（来自 file input）
 * @param edge - 输出正方形边长，默认 512
 * @returns 512×512 的 jpeg blob（含边长，供上传/预览）
 * @remarks
 * - 与消息图片不同，头像统一裁成正方形并再编码，gif 因此转为静态首帧
 * - 解码与 canvas 失败路径复用 compressImage 的 decode/canvasToBlob，
 *   toBlob 失败时回退原 blob（宁可传原图也不阻塞保存）
 */
export async function cropAvatar(file: Blob, edge: number = AVATAR_EDGE): Promise<CompressedImage> {
  const bitmap = await decode(file);
  const { sx, sy, side, out } = centerSquareCrop(bitmap.width, bitmap.height, edge);

  const canvas = document.createElement("canvas");
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    dispose(bitmap);
    return { blob: file, width: out, height: out };
  }
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, out, out);
  dispose(bitmap);

  const blob = await canvasToBlob(canvas, "image/jpeg", 0.85);
  return { blob: blob ?? file, width: out, height: out };
}

/** Blob 内容 SHA-256 摘要（十六进制小写），用于贴纸收藏去重。Chrome 74+ 原生 crypto.subtle 支持。 */
export async function hashBlob(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
