/// <reference lib="webworker" />
/**
 * 自定义 Service Worker（vite-plugin-pwa injectManifest 模式）
 *
 * @description
 * 两部分职责：
 * 1. **离线可用**：Workbox precache app shell + 运行时缓存
 *    （头像 CacheFirst / GET API NetworkFirst），导航请求离线回退 index.html
 * 2. **Web Push**：接收后端 VAPID 推送 → 弹系统通知 → 点击聚焦/打开对应会话
 *
 * 注意：dev 模式不注册本 SW（MSW 的 mockServiceWorker.js 占用根 scope）。
 */
import {
  precacheAndRoute,
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { CacheFirst, NetworkFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";

// injectManifest 在构建期把预缓存清单注入 self.__WB_MANIFEST
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// ---------- 预缓存（构建期由 injectManifest 注入清单）----------
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// SPA 导航离线回退：/api/ 不走回退（应交由网络失败）
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("index.html"), {
    denylist: [/^\/api\//],
  }),
);

// 头像等对象存储图片：缓存优先，30 天
registerRoute(
  ({ url }: { url: URL }) => url.pathname.includes("/avatars/"),
  new CacheFirst({
    cacheName: "yuanchat-avatars",
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  }),
);

// GET API：网络优先，5s 超时后回退缓存（离线可读上次的会话/联系人列表）
registerRoute(
  ({ url, request }: { url: URL; request: Request }) =>
    request.method === "GET" && url.pathname.startsWith("/api/v1/"),
  new NetworkFirst({
    cacheName: "yuanchat-api-get",
    networkTimeoutSeconds: 5,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 }),
    ],
  }),
);

// 新版本 SW 立即接管（registerType: autoUpdate 配合）
self.addEventListener("install", () => {
  void self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// ---------- Web Push ----------

interface PushPayload {
  title: string;
  body: string;
  conversation_id?: string;
  message_id?: string;
}

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload: PushPayload;
  try {
    payload = event.data.json() as PushPayload;
  } catch {
    payload = { title: "元聊 YuanChat", body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || "元聊 YuanChat", {
      body: payload.body,
      icon: "/pwa-192.png",
      badge: "/pwa-192.png",
      // 同一会话的连续推送折叠为一条，避免刷屏；renotify 让折叠时仍提醒
      // （lib.dom 的 NotificationOptions 尚未收录 renotify，故断言放行）
      tag: payload.conversation_id ? `conv-${payload.conversation_id}` : undefined,
      renotify: Boolean(payload.conversation_id),
      data: { conversationId: payload.conversation_id },
    } as NotificationOptions & { renotify: boolean }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const convId = (event.notification.data as { conversationId?: string } | null)?.conversationId;
  const target = convId ? `/chat?conversation=${convId}` : "/chat";

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // 已有窗口则聚焦并导航，避免重复开标签页
      for (const client of clients) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(target);
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
