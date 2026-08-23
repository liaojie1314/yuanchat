/**
 * ChatWindow 组件 — 聊天消息窗口
 *
 * @description
 * IM 应用最主要的交互界面，位于三栏布局的中间。组成：
 * 1. **顶部标题栏**：头像 + 名称 + 成员/在线信息 + 通话/搜索/详情按钮，
 *    移动端显示返回按钮
 * 2. **置顶消息条**：会话存在 pinnedMessage 时显示
 * 3. **消息流**：日期分隔线、全形态气泡（MessageBubble）、正在输入指示，
 *    新消息自动滚动到底部
 * 4. **输入区**：Composer（引用回复 / 工具条 / 自适应输入）
 *
 * @param onBack - 移动端返回会话列表回调，非空时显示返回按钮
 * @param onShowDetail - 打开详情面板/抽屉回调，非空时显示详情按钮
 * @param compactComposer - 移动端使用紧凑输入区
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowLeft,
  Loader2,
  Megaphone,
  MessageSquare,
  MoreHorizontal,
  Phone,
  Pin,
  Search,
  Video,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  addFavorite,
  addSticker,
  ApiError,
  formatDateDivider,
  getDownloadUrl,
  hashBlob,
  isServerConfirmed,
  quoteExcerptOf,
  recallMessage,
  RE_EDIT_WINDOW_MS,
  reportMessage,
  showToast,
  toggleReaction,
  useAuthStore,
  useConversationStore,
  useMessageStore,
} from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";
import type { MentionRef } from "@yuanchat/shared";
import { Avatar } from "./Avatar";
import { AnnouncementDialog } from "./AnnouncementDialog";
import { Composer } from "./Composer";
import { ForwardModal } from "./ForwardModal";
import { E2EEIndicator } from "./E2EEIndicator";
import { SafetyNumberDialog } from "./SafetyNumberDialog";
import { ImageLightbox } from "./ImageLightbox";
import { InConversationSearch } from "./InConversationSearch";
import { MessageBubble, TypingIndicator } from "./MessageBubble";

export function ChatWindow({
  onBack,
  onShowDetail,
  onShowProfile,
  compactComposer = false,
}: {
  onBack?: () => void;
  onShowDetail?: () => void;
  /** 点消息头像：交给外层在详情面板位置打开资料页（缺省则头像不可点） */
  onShowProfile?: (target: { userId: string; name?: string; isSelf?: boolean }) => void;
  compactComposer?: boolean;
}) {
  const { t } = useTranslation();
  // 从 Zustand Store 中读取当前活跃会话与消息流
  const activeId = useConversationStore((s) => s.activeId);
  const conversations = useConversationStore((s) => s.conversations);
  const conv = conversations.find((c) => c.id === activeId);

  const messages = useMessageStore((s) => (activeId ? s.messagesByConv[activeId] : undefined));
  const typingName = useMessageStore((s) => (activeId ? s.typingByConv[activeId] : undefined));
  const hasMore = useMessageStore((s) => (activeId ? s.hasMoreByConv[activeId] : false));
  const sendText = useMessageStore((s) => s.sendText);
  const retrySend = useMessageStore((s) => s.retrySend);
  const loadHistory = useMessageStore((s) => s.loadHistory);
  const loadMore = useMessageStore((s) => s.loadMore);
  const setReplyingTo = useMessageStore((s) => s.setReplyingTo);
  const replyingTo = useMessageStore((s) => s.replyingTo);

  const highlightMsgId = useMessageStore((s) => s.highlightMsgId);
  const setHighlightMsgId = useMessageStore((s) => s.setHighlightMsgId);

  const scrollRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);
  const isAtBottomRef = useRef(true);
  const prevCountRef = useRef(0);
  // 全屏查看的图片 URL（null 表示未打开）
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  // 转发弹窗当前源消息 ID（null 表示关闭）
  const [forwardMsgId, setForwardMsgId] = useState<string | null>(null);
  // 会话内搜索面板开关
  const [showSearch, setShowSearch] = useState(false);
  // 安全指纹校验弹窗开关（E2EE，仅单聊）
  const [showSafetyNumber, setShowSafetyNumber] = useState(false);
  // 群公告全文弹层开关
  const [showAnnouncement, setShowAnnouncement] = useState(false);
  const selfUserId = useAuthStore((s) => s.user?.id);

  const items = messages ?? [];

  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 80,
    overscan: 5,
  });

  // 进入会话时按需加载历史（真实模式；mock 模式内部直接跳过）
  useEffect(() => {
    if (activeId) void loadHistory(activeId);
  }, [activeId, loadHistory]);

  // 新消息到达时自动滚动到底部（loadMore 预置不触发，避免跳动）
  useEffect(() => {
    if (items.length === 0) return;
    if (loadingMoreRef.current) return;
    if (isAtBottomRef.current) {
      rowVirtualizer.scrollToIndex(items.length - 1, { align: "end", behavior: "auto" });
    }
    // rowVirtualizer 引用稳定，不加入 deps 防止无限循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, activeId]);

  // loadMore 预置旧消息后恢复视口位置
  useEffect(() => {
    if (!loadingMoreRef.current) {
      prevCountRef.current = items.length;
      return;
    }
    const added = items.length - prevCountRef.current;
    if (added > 0) {
      rowVirtualizer.scrollToIndex(added, { align: "start", behavior: "auto" });
    }
    prevCountRef.current = items.length;
    loadingMoreRef.current = false;
    // rowVirtualizer 引用稳定，不加入 deps 防止无限循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  // 搜索跳转：highlightMsgId 变化时滚动到目标消息并 2 秒后清除高亮
  useEffect(() => {
    if (!highlightMsgId || items.length === 0) return;
    const index = items.findIndex((m) => m.id === highlightMsgId);
    if (index === -1) return;
    rowVirtualizer.scrollToIndex(index, { align: "center", behavior: "smooth" });
    const timer = setTimeout(() => setHighlightMsgId(null), 2000);
    return () => clearTimeout(timer);
    // rowVirtualizer 引用稳定，不加入 deps 防止无限循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightMsgId, setHighlightMsgId, items]);

  // 滚动到顶部时向上翻页
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isAtBottomRef.current = distFromBottom < 100;
    if (!activeId || !hasMore || loadingMoreRef.current || el.scrollTop > 40) return;
    loadingMoreRef.current = true;
    prevCountRef.current = items.length;
    void loadMore(activeId)
      .then(() => {
        // 防御：loadMore 未带回新数据时解除互斥锁，防止后续加载永久失效
        const currentCount = useMessageStore.getState().messagesByConv[activeId]?.length ?? 0;
        if (currentCount <= prevCountRef.current) {
          loadingMoreRef.current = false;
        }
      })
      .catch(() => {
        loadingMoreRef.current = false;
      });
  }, [activeId, hasMore, loadMore, items.length]);

  // 防御：如果没找到会话（activeId 无效或为 null），不渲染
  if (!conv) return null;

  // 群公告未读态：localStorage 记录的已读标记时间 < 公告最近更新时间即视为未读
  // （跨设备/清缓存后会重新判定为未读，属预期行为，非 bug）。
  // 注意：不同来源的 RFC3339 时间戳可能带不同时区偏移后缀（+08:00 vs Z），
  // 字典序不等于时间序，须转 epoch 数值比较（同 ConversationList 对 pinnedAt 排序的处理）；
  // localStorage 空值 Date.parse("") 为 NaN，用 || 0 兜底成最小值（即"从未读过"）。
  const announcementReadKey = "announcement-read:" + conv.id;
  const isAnnouncementUnread = conv.announcementUpdatedAt
    ? (Date.parse(localStorage.getItem(announcementReadKey) ?? "") || 0) <
      Date.parse(conv.announcementUpdatedAt)
    : false;
  const openAnnouncement = () => {
    setShowAnnouncement(true);
    localStorage.setItem(announcementReadKey, conv.announcementUpdatedAt ?? "");
  };

  const subtitle =
    conv.type === "group"
      ? [
          conv.memberCount ? t("chat.members", { count: conv.memberCount }) : null,
          conv.onlineCount ? t("chat.onlineCount", { count: conv.onlineCount }) : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : conv.isOnline || conv.presence === "online"
        ? t("common.online")
        : t("common.offline");

  const handleSend = (text: string, mentions: MentionRef[]) => {
    if (!activeId) return;
    sendText(activeId, text, {
      mentions,
      quote: replyingTo
        ? {
            messageId: replyingTo.id,
            senderName: replyingTo.senderName ?? "我",
            // 图片/语音/贴纸此前恒为空串，引用条只剩昵称加一行空白
            excerpt: quoteExcerptOf(replyingTo),
          }
        : undefined,
    });
  };

  const handleForward = (messageId: string) => setForwardMsgId(messageId);

  // 撤回：调服务端（用服务端 id）→ 成功靠 message.recalled 帧统一 applyRecall，不乐观翻转。
  const handleRecall = (messageId: string) => {
    recallMessage(messageId).catch((err) => {
      if (err instanceof ApiError && err.code === 4031) {
        showToast("error", t("chat.message.recallExpired"));
      } else {
        showToast("error", t("common.opFailed"));
      }
    });
  };

  /**
   * 从图片消息收藏为贴纸：取图字节算 SHA-256（后端按 (owner, hash) 去重）→ POST /stickers。
   * 图片对象已在 MinIO 的 images/ 下，故直接复用其 object_key，不重新上传。
   *
   * @remarks fetch 对 4xx/5xx 不 reject，必须显式查 r.ok：否则预签名过期 / 对象已清理 /
   *   反代 502 时会把错误页正文当图片字节算 hash 收藏成功，用户看到"已添加"，
   *   而收藏项是永久空白格；更糟的是错误页 hash ≠ 真实图片 hash，后端 (owner, hash)
   *   去重被打穿——网络恢复后收藏同一张图会插入第二行。
   */
  const handleAddSticker = async (imageKey: string, width: number, height: number) => {
    try {
      const url = await getDownloadUrl(imageKey);
      const res = await fetch(url);
      if (!res.ok) {
        // 404/403 = 对象已不存在或签名失效，重试无意义；与网络故障分开提示
        const expired = res.status === 403 || res.status === 404;
        showToast("error", t(expired ? "sticker.addFailedExpired" : "sticker.addFailed"));
        return;
      }
      const blob = await res.blob();
      const hash = await hashBlob(blob);
      await addSticker(imageKey, width, height, hash);
      showToast("info", t("sticker.addSuccess"));
    } catch {
      showToast("error", t("sticker.addFailed"));
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* 顶部标题栏 */}
      <header className="border-outline-variant bg-surface-container-low flex h-[60px] shrink-0 items-center gap-3 border-b pr-2 pl-3">
        {onBack && (
          <button
            onClick={onBack}
            className="md3-icon-btn text-on-surface -ml-1"
            aria-label={t("chat.back")}
          >
            <ArrowLeft size={22} />
          </button>
        )}
        <Avatar name={conv.name} src={conv.avatarUrl} presence={conv.presence} />
        <div className="min-w-0 flex-1">
          <h2 className="text-title-md text-on-surface truncate font-semibold">{conv.name}</h2>
          <p className="text-label-sm text-on-surface-variant truncate">{subtitle}</p>
        </div>
        <E2EEIndicator
          selfId={selfUserId}
          peerId={conv.type === "private" ? conv.peerId : undefined}
          onClick={() => setShowSafetyNumber(true)}
        />
        <button
          className="md3-icon-btn text-on-surface-variant"
          title={t("chat.voiceCall")}
          aria-label={t("chat.voiceCall")}
        >
          <Phone size={19} />
        </button>
        <button
          className="md3-icon-btn text-on-surface-variant"
          title={t("chat.videoCall")}
          aria-label={t("chat.videoCall")}
        >
          <Video size={19} />
        </button>
        <button
          onClick={() => setShowSearch((v) => !v)}
          className="md3-icon-btn text-on-surface-variant hidden sm:grid"
          title={t("chat.searchHistory")}
          aria-label={t("chat.searchHistory")}
        >
          <Search size={19} />
        </button>
        {onShowDetail && (
          <button
            onClick={onShowDetail}
            className="md3-icon-btn text-on-surface-variant"
            title={t("chat.details")}
            aria-label={t("chat.details")}
          >
            <MoreHorizontal size={19} />
          </button>
        )}
      </header>

      {/* 会话内搜索面板 */}
      {showSearch && activeId && (
        <InConversationSearch conversationId={activeId} onClose={() => setShowSearch(false)} />
      )}

      {/* 群公告横幅（群聊且公告非空时显示；未读时加粗 + 高亮点） */}
      {conv.type === "group" && conv.announcement && (
        <button
          onClick={openAnnouncement}
          className="bg-primary-container text-primary-on-container flex h-9 w-full shrink-0 items-center gap-2 px-4 text-left"
        >
          <Megaphone size={13} className="shrink-0" />
          <span className={cn("text-label-md", isAnnouncementUnread && "font-bold")}>
            {t("chat.announcementLabel")}
          </span>
          <span
            className={cn(
              "text-body-sm min-w-0 flex-1 truncate",
              isAnnouncementUnread && "font-semibold",
            )}
          >
            {conv.announcement}
          </span>
          {isAnnouncementUnread && (
            <span className="bg-error h-1.5 w-1.5 shrink-0 rounded-full" aria-hidden="true" />
          )}
          <span className="text-label-sm shrink-0 opacity-70">
            {t("chat.announcementViewFull")}
          </span>
        </button>
      )}

      {/* 置顶消息条 */}
      {conv.pinnedMessage && (
        <div className="bg-primary-container text-primary-on-container flex h-9 shrink-0 items-center gap-2 px-4">
          <Pin size={13} className="shrink-0" />
          <span className="text-label-md font-semibold">{t("chat.pinnedLabel")}</span>
          <span className="text-body-sm min-w-0 flex-1 truncate">{conv.pinnedMessage}</span>
        </div>
      )}

      {/* 消息流 — 虚拟滚动 */}
      <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto">
        {messages === undefined ? (
          <MessageSkeleton />
        ) : messages.length === 0 ? (
          <EmptyMessages />
        ) : (
          <>
            {/* 向上翻页加载指示 — 悬浮在虚拟列表外部，不占用绝对定位空间 */}
            {hasMore && (
              <div className="text-on-surface-variant flex justify-center py-1">
                <Loader2 size={16} className="animate-spin" />
              </div>
            )}
            <div
              style={{
                height: rowVirtualizer.getTotalSize() + (typingName ? 48 : 0),
                position: "relative",
              }}
              className="py-2"
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const msg = items[virtualRow.index];
                const prev = virtualRow.index > 0 ? items[virtualRow.index - 1] : undefined;
                const showDivider = !!msg.dateKey && msg.dateKey !== prev?.dateKey;
                const compact =
                  !showDivider &&
                  !!prev &&
                  prev.kind !== "system" &&
                  msg.kind !== "system" &&
                  prev.isSelf === msg.isSelf &&
                  prev.senderName === msg.senderName &&
                  minutesBetween(prev.time, msg.time) < 1;
                return (
                  <div
                    key={virtualRow.key}
                    ref={rowVirtualizer.measureElement}
                    data-index={virtualRow.index}
                    data-msg-id={msg.id}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    className={cn(
                      "px-4",
                      highlightMsgId === msg.id
                        ? "rounded-lg ring-2 ring-blue-400 ring-offset-1"
                        : undefined,
                    )}
                  >
                    {showDivider && <DateDivider label={formatDateDivider(msg.dateKey!)} />}
                    <MessageBubble
                      msg={msg}
                      compact={compact}
                      onRetry={
                        msg.status === "failed" && activeId
                          ? () => retrySend(activeId, msg.id)
                          : undefined
                      }
                      onReply={
                        // 引用回复会把 reply_to_id 一起发给服务端，未 ack 的消息 id
                        // 还是 clientMsgId → 整帧 400 且无法定位（见 isServerConfirmed）。
                        // 此前这里是唯一没有闸门的菜单项，且双击气泡就能触发。
                        isServerConfirmed(msg) ? () => setReplyingTo(msg) : undefined
                      }
                      onImageClick={setLightboxUrl}
                      onRecall={
                        // 仅自己且已送达（sent/read）的消息可撤回：sending/failed 只有本地
                        // client id、无服务端 id，撤回需用服务端 id，故不提供
                        msg.isSelf && (msg.status === "sent" || msg.status === "read")
                          ? () => handleRecall(msg.id)
                          : undefined
                      }
                      onReEdit={
                        msg.recalled && msg.isSelf && msg.recalledText
                          ? () => {
                              if (Date.now() - (msg.recalledAtMs ?? 0) > RE_EDIT_WINDOW_MS) {
                                showToast("info", t("chat.message.reEditExpired"));
                                return;
                              }
                              useMessageStore.getState().setComposerInsert(msg.recalledText ?? "");
                            }
                          : undefined
                      }
                      onReact={
                        isServerConfirmed(msg)
                          ? (emoji) => {
                              void toggleReaction(msg.id, emoji).catch(() =>
                                showToast("error", t("common.opFailed")),
                              );
                            }
                          : undefined
                      }
                      onForward={isServerConfirmed(msg) ? () => handleForward(msg.id) : undefined}
                      onFavorite={
                        isServerConfirmed(msg)
                          ? () => {
                              void addFavorite(msg.id)
                                .then(() => showToast("info", t("favorites.added")))
                                .catch(() => showToast("error", t("favorites.addFailed")));
                            }
                          : undefined
                      }
                      onAddSticker={
                        // 只对已确认的图片消息提供"添加到表情"（收藏走 REST，需服务端 id）
                        isServerConfirmed(msg) && msg.kind === "image" && msg.image?.key
                          ? () =>
                              void handleAddSticker(
                                msg.image!.key!,
                                msg.image!.width,
                                msg.image!.height,
                              )
                          : undefined
                      }
                      onReport={
                        // 只能举报别人的已确认消息
                        isServerConfirmed(msg) && !msg.isSelf
                          ? () => {
                              void reportMessage(msg.id)
                                .then(() => showToast("info", t("report.submitted")))
                                .catch(() => showToast("error", t("report.failed")));
                            }
                          : undefined
                      }
                      onAvatarClick={
                        // 自己的消息点自己的头像看自己的资料（乐观发送的本地条目没有
                        // senderId，用登录态的 userId 兜底）
                        onShowProfile && (msg.isSelf ? selfUserId : msg.senderId)
                          ? () =>
                              onShowProfile({
                                userId: (msg.isSelf ? selfUserId : msg.senderId)!,
                                name: msg.senderName,
                                isSelf: msg.isSelf,
                              })
                          : undefined
                      }
                    />
                  </div>
                );
              })}
              {/* 正在输入指示 — 绝对定位于虚拟列表底部 */}
              {typingName && (
                <div
                  style={{
                    position: "absolute",
                    top: rowVirtualizer.getTotalSize(),
                    left: 0,
                    width: "100%",
                  }}
                  className="px-4"
                >
                  <TypingIndicator name={typingName} />
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* 输入区 */}
      <Composer onSend={handleSend} compact={compactComposer} />

      {/* 图片全屏查看器（点击气泡内图片打开） */}
      {lightboxUrl && <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}

      <ForwardModal
        open={forwardMsgId !== null}
        sourceMessageId={forwardMsgId}
        sourceConversationId={activeId}
        onClose={() => setForwardMsgId(null)}
      />

      {/* 安全指纹校验（E2EE 单聊，点击头部锁图标打开） */}
      {selfUserId && conv.type === "private" && conv.peerId && (
        <SafetyNumberDialog
          selfId={selfUserId}
          peerId={conv.peerId}
          peerName={conv.name}
          open={showSafetyNumber}
          onClose={() => setShowSafetyNumber(false)}
        />
      )}

      {/* 群公告全文弹层 */}
      <AnnouncementDialog
        open={showAnnouncement}
        announcement={conv.announcement ?? ""}
        onClose={() => setShowAnnouncement(false)}
      />
    </div>
  );
}

/** 解析两条消息 "HH:mm" 标签的分钟差；跨天由 showDivider 拦住，此处只需同日比较 */
function minutesBetween(a: string, b: string): number {
  const pa = a.split(":");
  const pb = b.split(":");
  if (pa.length !== 2 || pb.length !== 2) return Infinity;
  const ma = Number(pa[0]) * 60 + Number(pa[1]);
  const mb = Number(pb[0]) * 60 + Number(pb[1]);
  if (isNaN(ma) || isNaN(mb)) return Infinity;
  return Math.abs(mb - ma);
}

/** 日期分隔线：居中胶囊 + 两侧分隔线 */
function DateDivider({ label }: { label: string }) {
  return (
    <div className="text-label-md text-on-surface-variant my-2 flex items-center gap-3">
      <span className="bg-outline-variant h-px flex-1" />
      {label}
      <span className="bg-outline-variant h-px flex-1" />
    </div>
  );
}

/** 空消息态：图标 + 文案，居中（复用 ChatScreen EmptyState 风格） */
function EmptyMessages() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="text-center">
        <div className="bg-surface-container-high text-on-surface-variant mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full">
          <MessageSquare size={40} strokeWidth={1.5} />
        </div>
        <p className="text-body-md text-on-surface-variant">{t("chat.emptyMessages")}</p>
      </div>
    </div>
  );
}

/** 消息加载骨架：4 条左右交替的气泡占位（pulse，固定高度防 CLS） */
function MessageSkeleton() {
  const rows = [false, true, false, true];
  return (
    <div className="flex flex-col gap-4 px-4 py-4" aria-hidden>
      {rows.map((isSelf, i) => (
        <div
          key={i}
          className={cn("flex animate-pulse items-end gap-2", isSelf && "flex-row-reverse")}
        >
          <span className="bg-surface-container-high h-10 w-10 shrink-0 rounded-full" />
          <span
            className={cn(
              "bg-surface-container-high h-10 rounded-lg",
              i % 2 === 0 ? "w-48" : "w-32",
            )}
          />
        </div>
      ))}
    </div>
  );
}
