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
 * - `extractVideoMeta` 视频专用：读时长/宽高 + canvas 抽首帧编码 jpeg 缩略图（服务端不转码）
 *
 * 兼容性：产物经 es2019 转译；createImageBitmap 在 Chrome 74 WebView 可用，
 * 不可用时回退 new Image() + objectURL。
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { apiGet, apiPost } from "./client";

/** 预签名上传票据：客户端凭 uploadUrl PUT 直传，objectKey 用于后续 message.send / 下载 */
export interface UploadTicket {
  uploadUrl: string;
  objectKey: string;
  /** 仅公共读类别（avatars / sticker-covers）返回：匿名可访问地址，无需再签下载 */
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
 * @param category - 显式类别；avatars / sticker-covers 走匿名公共读（返回 publicUrl），
 *   缺省按 contentType 推断
 * @throws ApiError 4001 类型/扩展名非法 · 4002 超大 · 503 存储不可达
 */
export async function getUploadUrl(
  filename: string,
  contentType: string,
  size: number,
  category?: "images" | "avatars" | "sticker-covers",
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
// 视频元数据与抽帧缩略图
// ========================================

/** 视频元数据 + 首帧缩略图（服务端不转码不抽帧，两者全由客户端产出） */
export interface VideoMeta {
  /** 时长（整秒；服务端只接受 1-120s，故不足 1 秒按 1 秒上报） */
  duration: number;
  /** 像素尺寸（气泡等比占位，防 CLS） */
  width: number;
  height: number;
  /** JPEG 缩略图，上传后作为 `thumb_key`（video 帧必填字段） */
  thumbnail: Blob;
}

/** 元数据读取超时：个别 WebView 对损坏文件既不 loadedmetadata 也不 error，不设超时会永久停在「发送中」 */
const VIDEO_META_TIMEOUT_MS = 10_000;

/** 等 seeked 的超时：个别 WebView 不发该事件，超时后退化为「抓当前帧」而不是让整条消息发失败 */
const VIDEO_SEEK_TIMEOUT_MS = 10_000;

/** seeked 超时后若帧数据仍不足，额外等这么久：宁可多等一会儿，也不画一帧必然纯黑的空白 */
const VIDEO_FRAME_GRACE_MS = 1_500;

/** readyState 轮询间隔：宽限期内没有事件可依赖时靠它发现帧数据到位 */
const READY_STATE_POLL_MS = 50;

/**
 * 可绘制的最低 readyState（`HAVE_CURRENT_DATA`）。
 *
 * @remarks 低于此值 `drawImage(video)` 画出来是**纯黑**——真机实测：同一视频同一时间点，
 *   readyState=1 时抽出的 JPEG 全图 `min=0 max=0 avg=0`，readyState=4 时亮度 127。
 */
const HAVE_CURRENT_DATA = 2;

/** 缩略图最长边：仅作气泡 poster，无需原始分辨率 */
const THUMB_MAX_EDGE = 640;

/**
 * 读取视频元数据并抽首帧编码为 JPEG 缩略图。
 *
 * @param file - 用户选中的视频文件
 * @returns 整秒时长、像素宽高与 JPEG 缩略图 blob
 * @throws Error 元数据不可读（超时 / 解码失败 / 宽高或时长为 0）或抽帧失败
 * @remarks
 * - 缩略图**不可缺省**：`message.send` 的 video 帧要求 `thumb_key` 非空（服务端缺字段直接 400），
 *   故抽帧失败在此抛错，由调用方 toast + 置消息失败——宁可本地失败并提示，
 *   也不发一帧注定被服务端拒收的消息。
 * - 兼容性：只用 `<video>` + `URL.createObjectURL` + `canvas.drawImage`，Chrome 74 WebView 均可用
 *   （不依赖 requestVideoFrameCallback / createImageBitmap(video)）。
 */
export async function extractVideoMeta(file: Blob): Promise<VideoMeta> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  // 静音 + 内联播放：部分 WebView 对带声音的媒体有手势限制，会卡在 seek 不出帧
  video.muted = true;
  video.playsInline = true;
  try {
    const metaReady = waitForVideoEvent(video, "loadedmetadata", VIDEO_META_TIMEOUT_MS, "meta");
    video.src = url;
    await metaReady;

    const width = video.videoWidth;
    const height = video.videoHeight;
    const rawDuration = video.duration;
    if (!width || !height || !isFinite(rawDuration) || rawDuration <= 0) {
      throw new Error("video metadata unreadable");
    }

    // 取 0.5s 处的帧（短视频取中点）：首帧常是纯黑，做封面看不出内容
    const thumbnail = await captureVideoFrame(video, Math.min(0.5, rawDuration / 2), width, height);
    return { duration: Math.max(1, Math.round(rawDuration)), width, height, thumbnail };
  } finally {
    // 解绑 src 并 load() 让 WebView 立即释放解码器，再撤销 blob URL
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

/**
 * 等待某个媒体事件到达。
 *
 * @param event - 要等的事件名（**只等一个**：曾经把 `seeked` 与 `loadeddata` 放进
 *   同一个竞速里"互为兜底"，而 `loadeddata` 在 readyState=1 就到，于是抽帧抽到黑屏。
 *   兜底应当由 readyState 判定承担，不能靠更早的事件顶包）
 * @param label - 抛错信息前缀，便于区分是元数据阶段还是抽帧阶段
 * @throws Error `error` 事件或超时
 */
function waitForVideoEvent(
  video: HTMLVideoElement,
  event: string,
  timeoutMs: number,
  label: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // 定时器先建、settle 后定义：两者互相引用，而回调都在本轮同步代码之后才执行
    const timer = setTimeout(() => settle(new Error(label + " timeout")), timeoutMs);
    const settle = (err?: Error) => {
      clearTimeout(timer);
      video.removeEventListener(event, onHit);
      video.removeEventListener("error", onFail);
      if (err) reject(err);
      else resolve();
    };
    const onHit = () => settle();
    const onFail = () => settle(new Error(label + " failed"));
    video.addEventListener(event, onHit);
    video.addEventListener("error", onFail);
  });
}

/**
 * 等 readyState 达标（或宽限用尽）。
 *
 * @param min - 目标 readyState 下限
 * @param timeoutMs - 宽限上限
 * @remarks **永不 reject**：宽限用尽后调用方仍会抽一帧（暗封面 > 发不出去）。
 *   同时监听事件与轮询：`seeked` 缺失的 WebView 往往连 `canplay` 都不给，
 *   只能靠轮询发现帧数据到位。
 */
function waitForReadyState(video: HTMLVideoElement, min: number, timeoutMs: number): Promise<void> {
  if (video.readyState >= min) return Promise.resolve();
  return new Promise((resolve) => {
    const events = ["loadeddata", "canplay", "canplaythrough", "seeked", "timeupdate"];
    const timer = setTimeout(() => finish(), timeoutMs);
    const poll = setInterval(() => check(), READY_STATE_POLL_MS);
    const finish = () => {
      clearTimeout(timer);
      clearInterval(poll);
      for (const ev of events) video.removeEventListener(ev, check);
      resolve();
    };
    const check = () => {
      if (video.readyState >= min) finish();
    };
    for (const ev of events) video.addEventListener(ev, check);
  });
}

/**
 * seek 到指定秒后把当前帧画进 canvas 并编码 JPEG（质量 0.75）。
 *
 * @remarks 等待策略（真机实测踩出来的顺序）：
 * 1. **只等 `seeked`**：真机事件序是
 *    `loadedmetadata(rs4) → loadeddata(rs1) → canplay(rs1) → seeked(rs4)`。
 *    原实现把 `seeked` 与 `loadeddata` 放进竞速，`loadeddata` 先到且此时
 *    readyState=1（目标帧还没解码），画出来的 JPEG 全黑（avg=0，seeked 后为 127）——
 *    "取 0.5s 处避免首帧纯黑"的意图被这条竞速彻底抵消。
 * 2. `seeked` 超时/报错**不失败**：个别 WebView 不发该事件，而 `thumb_key` 是服务端
 *    必填字段，抛错等于整条消息发不出去，故退化为「抓当下这一帧」。
 * 3. 绘制前必须 `readyState >= HAVE_CURRENT_DATA`；不足则再宽限
 *    {@link VIDEO_FRAME_GRACE_MS}，而不是直接画一帧必然纯黑的空白。
 */
async function captureVideoFrame(
  video: HTMLVideoElement,
  at: number,
  width: number,
  height: number,
): Promise<Blob> {
  const seeked = waitForVideoEvent(video, "seeked", VIDEO_SEEK_TIMEOUT_MS, "seek");
  video.currentTime = at;
  try {
    await seeked;
  } catch {
    // 超时或 error：不放弃缩略图，交给下面的 readyState 闸门决定还要不要再等
  }
  if (video.readyState < HAVE_CURRENT_DATA) {
    await waitForReadyState(video, HAVE_CURRENT_DATA, VIDEO_FRAME_GRACE_MS);
  }

  const scale = Math.min(1, THUMB_MAX_EDGE / Math.max(width, height));
  const outW = Math.max(1, Math.round(width * scale));
  const outH = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  ctx.drawImage(video, 0, 0, outW, outH);
  const blob = await canvasToBlob(canvas, "image/jpeg", 0.75);
  if (!blob) throw new Error("thumbnail encode failed");
  return blob;
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

/**
 * Blob 内容 SHA-256 摘要（十六进制小写），用于贴纸收藏去重。
 *
 * @remarks 实现用 `@noble/hashes` 而非 `crypto.subtle`：后者只在**安全上下文**
 *   （https / localhost）下存在，而"局域网 IP 直连自建 IM"是本项目的现实部署形态
 *   （`http://192.168.x.x`）——那里 `crypto.subtle` 是 `undefined`，
 *   调用直接 TypeError，被上层裸 `catch` 吞成"添加失败"，且重试一百次都一样。
 *   同一原因，整个 E2EE 栈也是纯 TS 的 `@noble`（见 `crypto/primitives.ts`），
 *   `@noble/hashes` 早已是 shared 的既有依赖，换过来零新增依赖。
 */
export async function hashBlob(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const digest = sha256(new Uint8Array(buf));
  let hex = "";
  // 不用 Array.from(...).map(...).join("")：热路径上逐字节拼接更省一次数组分配，
  // 且避免 es2019 目标下对 TypedArray 的 Array.from 转译开销。
  for (let i = 0; i < digest.length; i++) {
    hex += digest[i].toString(16).padStart(2, "0");
  }
  return hex;
}
