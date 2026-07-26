/**
 * Web Push 订阅管理（PWA 浏览器通知）
 *
 * @description
 * 与 WS 实时通道互补：应用关闭/后台且无 WS 连接时，后端改走 Web Push
 * 让系统弹通知。链路：
 *   1. 拉后端 VAPID 公钥（未配置则整体不可用）
 *   2. Notification.requestPermission()
 *   3. serviceWorkerRegistration.pushManager.subscribe(VAPID)
 *   4. 订阅信息 POST 给后端存库
 *
 * 兼容性：不支持 Service Worker / Push API 的环境（旧 WebView、Tauri
 * 桌面端）全部走 isPushSupported() 判假，调用方隐藏入口即可。
 */
import { apiGet, apiPost, request } from "../api/client";

/** base64url（VAPID 公钥格式）→ Uint8Array（subscribe 要求） */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

/** ArrayBuffer → base64（订阅密钥上报后端） */
function bufferToBase64(buf: ArrayBuffer | null): string {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** 当前环境是否支持 Web Push */
export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** 当前通知权限状态 */
export function pushPermission(): NotificationPermission | "unsupported" {
  if (!isPushSupported()) return "unsupported";
  return Notification.permission;
}

interface PublicKeyResponse {
  enabled: boolean;
  public_key: string;
}

/** 拉后端 VAPID 公钥；后端未配置时 enabled=false */
export async function fetchPushConfig(): Promise<PublicKeyResponse> {
  try {
    return await apiGet<PublicKeyResponse>("/api/v1/push/public-key");
  } catch {
    return { enabled: false, public_key: "" };
  }
}

/**
 * 订阅推送：申请权限 → 向浏览器推送服务注册 → 上报后端。
 *
 * @returns true 表示订阅成功；false 表示不支持/被拒绝/后端未配置
 */
export async function subscribePush(): Promise<boolean> {
  if (!isPushSupported()) return false;

  const cfg = await fetchPushConfig();
  if (!cfg.enabled || !cfg.public_key) return false;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  const reg = await navigator.serviceWorker.ready;
  // 已有订阅直接复用（重复 subscribe 参数不同会抛错）
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(cfg.public_key),
    }));

  await apiPost("/api/v1/push/subscribe", {
    endpoint: sub.endpoint,
    keys: {
      p256dh: bufferToBase64(sub.getKey("p256dh")),
      auth: bufferToBase64(sub.getKey("auth")),
    },
  });
  return true;
}

/** 退订推送：浏览器侧注销 + 后端删除记录 */
export async function unsubscribePush(): Promise<void> {
  if (!isPushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;

  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  // DELETE 带 body：走底层 request（apiDelete 不支持 body）
  await request("/api/v1/push/subscribe", {
    method: "DELETE",
    body: JSON.stringify({ endpoint }),
  });
}

/** 当前是否已订阅（用于设置页开关初值） */
export async function isPushSubscribed(): Promise<boolean> {
  if (!isPushSupported()) return false;
  const reg = await navigator.serviceWorker.ready;
  return (await reg.pushManager.getSubscription()) !== null;
}
