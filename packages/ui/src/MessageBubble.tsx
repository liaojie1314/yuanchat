/**
 * MessageBubble 组件 — 单条聊天消息
 *
 * @description
 * 渲染消息流中的一条消息，覆盖 IM 的全部气泡形态：
 * - 文本（含 @提及 高亮 token、引用块）
 * - 图片（真实渲染：乐观本地预览 / 按 key 签下载 URL，点击开大图）
 * - 文件卡片（扩展名徽标 + 名称 + 大小 + 下载按钮）
 * - 语音（播放按钮 + 波形 + 时长 + "查看文字" AI 转写入口）
 * - 视频（封面缩略图 + 时长角标 + 播放钮，点开全屏播放层）
 * - 系统消息（居中胶囊，如 "会话加密已开启"）
 *
 * 状态与元信息：
 * - 自己的消息右对齐、品牌渐变底；对方消息左对齐、表面色底
 * - meta 行：时间（tabular-nums）+ 发送状态（旋转/单勾/蓝双勾/失败重试）
 * - 表情回应（reactions）胶囊，含我参与的高亮态
 * - 已编辑标记
 *
 * @param msg - 消息数据
 * @param compact - 与上一条同一发送者且 1 分钟内：省略头像与群聊昵称行，缩小行距
 * @param onRetry - 发送失败点击重试回调
 * @param onReply - 引用回复回调（右键 / 长按菜单触发，双击气泡为快捷方式）
 * @param onRecall - 撤回回调（右键 / 长按菜单触发，仅自己 2 分钟内的消息可用）
 * @param onImageClick - 点击图片气泡打开全屏查看器的回调，参数为当前展示 URL
 * @param onFavorite - 收藏消息回调（仅服务端已确认消息提供，撤回/系统消息不可收藏）
 * @param onAvatarClick - 点头像进入用户详情页（自己的消息点自己的头像；缺省则头像不可点）
 */
import {
  Check,
  CheckCheck,
  Copy,
  Download,
  Flag,
  Forward,
  Loader2,
  Pause,
  Play,
  Reply,
  RotateCcw,
  Smile,
  Sparkles,
  Star,
  Undo2,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { getDownloadUrl, showToast } from "@yuanchat/shared";
import type { ChatMessage } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";
import { Avatar } from "./Avatar";
import { MessageImage } from "./MessageImage";
import { MessageVideo } from "./MessageVideo";
import { StickerImage } from "./StickerImage";
import { copyText } from "./copyText";
import { fileIconOf } from "./fileIcon";
import { useLongPress } from "./useLongPress";
import { currentPlayingId, playVoice, subscribeVoicePlayer } from "./voicePlayer";

/** 菜单快捷回应条的固定 emoji */
const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🎉"];

/** 菜单与锚点（右键位置 / 长按触点）之间的间距（px） */
const MENU_GAP = 4;

/** 菜单距视口边缘的最小留白（px） */
const MENU_EDGE = 8;

/** 菜单自身可滚动时的最小高度（px），避免空间极小时缩成一条看不出是菜单 */
const MENU_MIN_HEIGHT = 96;

/** 气泡纵向位移超过该像素才因滚动关闭菜单，容忍「零位移」滚动事件与真机抖动 */
const SCROLL_CLOSE_DELTA = 8;

/** 把文本中的所有 @昵称 段切成高亮 token（只在消息 mentions 非空时启用） */
function renderTextWithMentions(text: string, mentions?: string[]) {
  if (!mentions?.length) return text;
  // 匹配 @+ 非空白字符串（保留原文形态；后端存 uuid，前端不做 uuid → 昵称反查，直接依赖发送时插入的 @昵称 文本）
  const parts = text.split(/(@[^\s@]+)/g);
  return parts.map((part, i) =>
    part.startsWith("@") ? (
      <span
        key={i}
        className="bg-primary-container text-primary-on-container rounded px-1 font-medium"
      >
        {part}
      </span>
    ) : (
      part
    ),
  );
}

export function MessageBubble({
  msg,
  compact = false,
  onRetry,
  onReply,
  onRecall,
  onReEdit,
  onReact,
  onForward,
  onImageClick,
  onFavorite,
  onAddSticker,
  onReport,
  onAvatarClick,
}: {
  msg: ChatMessage;
  compact?: boolean;
  onRetry?: () => void;
  onReply?: () => void;
  onRecall?: () => void;
  onReEdit?: () => void;
  onReact?: (emoji: string) => void;
  onForward?: () => void;
  onImageClick?: (url: string) => void;
  onFavorite?: () => void;
  onAddSticker?: () => void;
  onReport?: () => void;
  onAvatarClick?: () => void;
}) {
  const { t } = useTranslation();
  // 气泡内联操作菜单（右键 / 长按弹出，点外部关闭）
  const [menuOpen, setMenuOpen] = useState(false);
  // 撤回项是否在 2 分钟窗口内——在打开菜单的事件里用 Date.now() 求值并存下，
  // 避免在 render 里调用 Date.now()（不纯，react-hooks/purity 禁止）
  const [recallInWindow, setRecallInWindow] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  // 菜单锚点（视口坐标）：右键落点或长按触点。
  // 必须放在 state 里而不是 ref：安卓 WebView 长按到时会自己补发一次 contextmenu，
  // 和我们 500ms 的长按定时器只差几毫秒，于是「菜单已开着又开一次」。
  // 那一路 menuOpen 从 true 到 true 没有变化，定位 effect 不会重跑，
  // 而 openMenuAt 已经把 menuStyle 清成了 null——菜单就永久停在 visibility: hidden 的 0,0。
  // 锚点进 state 后每次呼出都是新对象，定位必定重量一次
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  // 开菜单瞬间气泡在视口中的纵向位置，用于判断后续滚动是否真的把气泡带走了
  const bubbleTopAtOpen = useRef(0);
  // 菜单最终定位：量到真实尺寸后才算出，算出前不可见，避免闪到错误位置
  const [menuStyle, setMenuStyle] = useState<{
    left: number;
    top: number;
    maxHeight?: number;
  } | null>(null);
  // 语音播放态：模块级单例播放器广播当前播放的 messageId
  const [voicePlayingId, setVoicePlayingId] = useState<string | null>(() => currentPlayingId());

  useEffect(() => {
    if (msg.kind !== "voice") return;
    return subscribeVoicePlayer(setVoicePlayingId);
  }, [msg.kind]);

  const isSelf = msg.isSelf;
  // 撤回资格（render 纯判定）：仅自己且父层给了回调；实际的 2 分钟窗口在开菜单时判
  const recallEligible = !!onRecall && isSelf && !!msg.createdAtMs;
  // 文本消息才提供复制项
  const canCopy = msg.kind === "text" && !!msg.text;
  // 引用回复：父层给了回调即可（文本/图片/文件/语音均可引用）
  const canReply = !!onReply;
  const canForward = !!onForward;
  // 菜单当前展示的撤回项（资格 + 窗口内）
  const showRecall = recallEligible && recallInWindow;

  /** 菜单是否有任何可用项：一项都没有就不弹 */
  const hasMenuItem = (withinWindow: boolean) =>
    withinWindow ||
    canCopy ||
    canReply ||
    !!onReact ||
    canForward ||
    !!onFavorite ||
    !!onAddSticker;

  /** 头像文字兜底：自己的消息服务端不回发送者昵称 */
  const avatarName = isSelf ? t("common.me") : (msg.senderName ?? "?");

  /** 撤回是否还在 2 分钟窗口内（Date.now 不纯，只能在事件里求值，不能在 render 调用） */
  const recallStillOpen = () => recallEligible && Date.now() - (msg.createdAtMs ?? 0) < 120_000;

  /** 在给定视口坐标处打开菜单 */
  const openMenuAt = (withinWindow: boolean, x: number, y: number) => {
    setRecallInWindow(withinWindow);
    setMenuAnchor({ x, y });
    bubbleTopAtOpen.current = bubbleRef.current?.getBoundingClientRect().top ?? 0;
    // 先清掉上一次的定位与限高，让 layout effect 量到未被裁的原始尺寸
    setMenuStyle(null);
    setMenuOpen(true);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    const withinWindow = recallStillOpen();
    if (!hasMenuItem(withinWindow)) return;
    e.preventDefault();
    openMenuAt(withinWindow, e.clientX, e.clientY);
  };

  /** 长按达成：按当下的撤回窗口重新判定可用项，再在触点处弹菜单 */
  const handleLongPress = (x: number, y: number) => {
    const withinWindow = recallStillOpen();
    if (!hasMenuItem(withinWindow)) return;
    openMenuAt(withinWindow, x, y);
  };

  // 触屏长按手势：位移容差 + 抬手后的合成事件豁免都在 hook 里，详见 useLongPress
  const { handlers: longPressHandlers, isTouchEcho } = useLongPress(handleLongPress);

  useEffect(() => {
    if (!menuOpen) return;
    // 点外部关闭；长按余波（手指未抬起 / 抬手后的合成鼠标事件）一律放行，
    // 否则真机上菜单会在弹出的同一瞬被自己的合成 mousedown 关掉
    const closeUnlessEcho = () => {
      if (isTouchEcho()) return;
      setMenuOpen(false);
    };
    // 菜单是 fixed 定位，气泡被滚走后菜单就指错地方了，故滚动要关；但只认「真的滚走了」：
    // 浏览器在右键/长按落点上会补发一次位移为零的 scroll（菜单弹出的同一毫秒就到），
    // 真机上手指的细微移动也会让列表抖动一两像素，无差别关闭等于菜单刚出现就消失
    const closeIfScrolledAway = () => {
      const top = bubbleRef.current?.getBoundingClientRect().top;
      if (top === undefined || Math.abs(top - bubbleTopAtOpen.current) > SCROLL_CLOSE_DELTA) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", closeUnlessEcho);
    // 触屏另加 touchstart：合成鼠标事件在部分机型上会被长按手势抑制，
    // 只监听 mousedown 时菜单会关不掉
    document.addEventListener("touchstart", closeUnlessEcho);
    document.addEventListener("scroll", closeIfScrolledAway, true);
    window.addEventListener("resize", closeUnlessEcho);
    return () => {
      document.removeEventListener("mousedown", closeUnlessEcho);
      document.removeEventListener("touchstart", closeUnlessEcho);
      document.removeEventListener("scroll", closeIfScrolledAway, true);
      window.removeEventListener("resize", closeUnlessEcho);
    };
  }, [menuOpen, isTouchEcho]);

  // 菜单挂载后按真实尺寸定位：优先向下展开，下方不够就翻上去，两边都不够则自身滚动
  useLayoutEffect(() => {
    if (!menuOpen || !menuAnchor) return;
    const menu = menuRef.current;
    if (!menu) return;
    const { x, y } = menuAnchor;
    const menuW = menu.offsetWidth;
    const menuH = menu.offsetHeight;
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;

    const spaceBelow = viewH - y - MENU_GAP - MENU_EDGE;
    const spaceAbove = y - MENU_GAP - MENU_EDGE;
    const below = menuH <= spaceBelow || spaceBelow >= spaceAbove;
    const room = below ? spaceBelow : spaceAbove;
    const maxHeight = menuH > room ? Math.max(room, MENU_MIN_HEIGHT) : undefined;
    const shownH = Math.min(menuH, maxHeight ?? menuH);

    // 自己的消息右对齐，菜单向左展开，避免总是撞右边缘
    const rawLeft = msg.isSelf ? x - menuW : x;
    const rawTop = below ? y + MENU_GAP : y - MENU_GAP - shownH;
    setMenuStyle({
      left: Math.min(Math.max(MENU_EDGE, rawLeft), Math.max(MENU_EDGE, viewW - menuW - MENU_EDGE)),
      top: Math.min(Math.max(MENU_EDGE, rawTop), Math.max(MENU_EDGE, viewH - shownH - MENU_EDGE)),
      maxHeight,
    });
  }, [menuOpen, menuAnchor, msg.isSelf]);

  // 系统消息：居中胶囊，无头像无气泡
  if (msg.kind === "system") {
    return (
      <div className="bg-surface-container text-label-md text-on-surface-variant mx-auto my-2.5 w-fit rounded-full px-3 py-1">
        {msg.text}
      </div>
    );
  }

  // 已撤回：整条走系统消息样式，忽略原 kind/text
  if (msg.recalled) {
    return (
      <div className="bg-surface-container text-label-md text-on-surface-variant mx-auto my-2.5 flex w-fit items-center gap-1.5 rounded-full px-3 py-1">
        {msg.isSelf
          ? t("chat.message.revokedBySelf")
          : t("chat.message.revokedBy", { name: msg.senderName ?? "" })}
        {msg.isSelf && msg.recalledText && onReEdit && (
          <button onClick={onReEdit} className="text-primary font-medium">
            {t("chat.message.reEdit")}
          </button>
        )}
      </div>
    );
  }

  const handleCopy = () => {
    void copyText(msg.text ?? "");
    setMenuOpen(false);
  };

  const handleReply = () => {
    setMenuOpen(false);
    onReply?.();
  };

  const handleForward = () => {
    setMenuOpen(false);
    onForward?.();
  };

  const handleRecall = () => {
    setMenuOpen(false);
    onRecall?.();
  };

  const handleFavorite = () => {
    setMenuOpen(false);
    onFavorite?.();
  };

  const handleAddSticker = () => {
    setMenuOpen(false);
    onAddSticker?.();
  };

  const handleReport = () => {
    setMenuOpen(false);
    onReport?.();
  };

  return (
    <div
      className={cn(
        "flex items-start gap-2.5",
        compact ? "mt-0.5" : "mt-2",
        isSelf && "flex-row-reverse",
      )}
    >
      {compact ? (
        <div className="w-10 shrink-0" aria-hidden />
      ) : onAvatarClick ? (
        // 头像可点：进资料页。注意不要把双击引用挂在整行上——
        // 头像也在行内，双击头像会连带引用这条消息（用户实测到的怪异行为）
        <button
          type="button"
          onClick={onAvatarClick}
          aria-label={t("profile.viewProfile")}
          className="shrink-0 rounded-full transition-opacity hover:opacity-80"
        >
          <Avatar name={avatarName} size="md" />
        </button>
      ) : (
        <Avatar name={avatarName} size="md" />
      )}

      <div className={cn("flex max-w-[70%] flex-col", isSelf && "items-end")}>
        {/* 群聊接收方显示发送者昵称（合并态省略） */}
        {!compact && !isSelf && msg.senderName && (
          <span className="text-label-sm text-primary mx-1 mb-1 font-medium">{msg.senderName}</span>
        )}

        <div className={cn("flex items-center gap-1.5", isSelf && "flex-row-reverse")}>
          <div
            ref={bubbleRef}
            // data-kind 挂在气泡本体（右键菜单的宿主元素）上：E2E 既能按形态计数，
            // 也能直接右键定位到会弹菜单的那个节点。原 E2E 用的选择器应用里不存在。
            data-kind={msg.kind}
            className={cn(
              "relative w-fit max-w-full break-words select-text",
              msg.kind === "sticker"
                ? "" // 贴纸：无背景、无圆角、无内边距
                : cn(
                    "rounded-lg",
                    msg.kind === "image" || msg.kind === "video" ? "p-1.5" : "px-3.5 py-2.5",
                    isSelf ? "msg-bubble-self rounded-br-sm" : "msg-bubble-peer rounded-bl-sm",
                  ),
            )}
            onContextMenu={handleContextMenu}
            onDoubleClick={onReply}
            {...longPressHandlers}
          >
            {/* 引用块 */}
            {msg.quote && (
              <div
                className={cn(
                  "mb-1.5 cursor-pointer rounded-md border-l-[3px] px-2 py-1",
                  isSelf
                    ? "border-white/80 bg-white/15"
                    : "border-primary bg-on-surface/5 dark:bg-white/5",
                )}
              >
                <div
                  className={cn(
                    "text-label-sm font-medium",
                    isSelf ? "text-white/95" : "text-primary",
                  )}
                >
                  {msg.quote.senderName}
                </div>
                <div className="text-body-sm truncate opacity-85">{msg.quote.excerpt}</div>
              </div>
            )}

            {msg.kind === "text" && (
              <span className="text-body-lg leading-relaxed whitespace-pre-wrap">
                {renderTextWithMentions(msg.text ?? "", msg.mentions)}
              </span>
            )}

            {msg.kind === "image" && msg.image && (
              <MessageImage image={msg.image} onOpen={onImageClick} />
            )}

            {msg.kind === "sticker" && msg.sticker && <StickerImage sticker={msg.sticker} />}

            {msg.kind === "video" && msg.video && <MessageVideo video={msg.video} />}

            {msg.kind === "file" && msg.file && (
              <div className="flex min-w-[220px] items-center gap-2.5">
                {(() => {
                  const { Icon, bg } = fileIconOf(msg.file.ext);
                  return (
                    <span
                      className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white",
                        bg,
                      )}
                    >
                      <Icon size={20} strokeWidth={1.75} />
                    </span>
                  );
                })()}
                <div className="min-w-0 flex-1">
                  <div className="text-body-md truncate font-semibold">{msg.file.name}</div>
                  <div className="text-label-sm mt-0.5 opacity-80">
                    {msg.file.size} · {msg.file.ext}
                  </div>
                </div>
                <button
                  aria-label={t("file.download")}
                  onClick={() => {
                    const key = msg.file?.key;
                    if (!key) return;
                    void getDownloadUrl(key)
                      .then((url) => window.open(url, "_blank"))
                      .catch(() => showToast("error", t("chat.file.downloadFailed")));
                  }}
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors",
                    isSelf
                      ? "bg-white/15 text-white hover:bg-white/25"
                      : "bg-primary-container text-primary-on-container hover:opacity-85",
                  )}
                >
                  <Download size={15} />
                </button>
              </div>
            )}

            {msg.kind === "voice" && msg.voice && (
              <div>
                <div className="flex min-w-[140px] items-center gap-2.5">
                  <button
                    onClick={() => {
                      const src = msg.voice?.localUrl;
                      const key = msg.voice?.key;
                      const resolveUrl = src
                        ? Promise.resolve(src)
                        : key
                          ? getDownloadUrl(key)
                          : null;
                      if (!resolveUrl) return;
                      void resolveUrl
                        .then((url) => playVoice(msg.id, url))
                        .catch(() => showToast("error", t("chat.voice.playFailed")));
                    }}
                    aria-label={t("chat.input.voice")}
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-transform active:scale-90",
                      isSelf
                        ? "bg-white/25 text-white"
                        : "bg-primary-container text-primary-on-container",
                    )}
                  >
                    {/* lucide 的 Pause/Play 只有描边，14px 下细到看不见，必须填充 */}
                    {voicePlayingId === msg.id ? (
                      <Pause size={14} fill="currentColor" />
                    ) : (
                      <Play size={14} fill="currentColor" />
                    )}
                  </button>
                  <span
                    className={cn(
                      "flex h-5 items-center gap-0.5",
                      voicePlayingId === msg.id && "voice-wave-playing",
                    )}
                    aria-hidden
                  >
                    {msg.voice.wave.map((h, i) => (
                      <i
                        key={i}
                        className="w-0.5 rounded-sm bg-current opacity-50"
                        // 相邻条错开相位，起伏才像波在往右跑；取模让长波形循环复用同一组延时
                        style={{ height: h, animationDelay: `${(i % 5) * 110}ms` }}
                      />
                    ))}
                  </span>
                  <span className="text-label-md tabular-nums">{msg.voice.seconds}&quot;</span>
                </div>
                <button
                  className={cn(
                    "text-label-sm mt-1 inline-flex items-center gap-1",
                    isSelf ? "text-white/90" : "text-primary",
                  )}
                >
                  <Sparkles size={12} /> {t("chat.voice.toText")}
                </button>
              </div>
            )}

            {/* 内联操作菜单：右键 / 长按弹出，快捷回应条 + 复制 + 引用 + 撤回。
                挂到 body 而不是气泡内：绝对定位的菜单会被消息列表的 overflow 裁掉，
                且同层后来的气泡（图片/贴纸）会盖在它上面 */}
            {menuOpen &&
              createPortal(
                <div
                  role="menu"
                  ref={menuRef}
                  onMouseDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                  style={{
                    left: menuStyle?.left ?? 0,
                    top: menuStyle?.top ?? 0,
                    maxHeight: menuStyle?.maxHeight,
                    // 定位算出前先隐藏，避免在原点闪一帧
                    visibility: menuStyle ? "visible" : "hidden",
                  }}
                  className="bg-surface-container-high border-outline-variant fixed z-40 min-w-[7rem] overflow-x-hidden overflow-y-auto rounded-lg border p-1 shadow-lg"
                >
                  {onReact && (
                    <div className="border-outline-variant flex gap-0.5 border-b px-1.5 pb-1">
                      {QUICK_REACTIONS.map((e) => (
                        <button
                          key={e}
                          role="menuitem"
                          onClick={() => {
                            setMenuOpen(false);
                            onReact(e);
                          }}
                          className="hover:bg-surface-container-low flex h-7 w-7 items-center justify-center rounded-lg text-base transition-transform active:scale-90"
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  )}
                  {canCopy && (
                    <button
                      role="menuitem"
                      onClick={handleCopy}
                      className="text-body-md text-on-surface hover:bg-surface-container-highest flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors"
                    >
                      <Copy size={15} /> {t("chat.message.copy")}
                    </button>
                  )}
                  {canReply && (
                    <button
                      role="menuitem"
                      onClick={handleReply}
                      className="text-body-md text-on-surface hover:bg-surface-container-highest flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors"
                    >
                      <Reply size={15} /> {t("chat.message.reply")}
                    </button>
                  )}
                  {canForward && (
                    <button
                      role="menuitem"
                      onClick={handleForward}
                      className="text-body-md text-on-surface hover:bg-surface-container-highest flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors"
                    >
                      <Forward size={15} /> {t("chat.message.forward")}
                    </button>
                  )}
                  {onFavorite && (
                    <button
                      role="menuitem"
                      onClick={handleFavorite}
                      className="text-body-md text-on-surface hover:bg-surface-container-highest flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors"
                    >
                      <Star size={15} /> {t("chat.message.favorite")}
                    </button>
                  )}
                  {onAddSticker && (msg.kind === "image" || msg.kind === "sticker") && (
                    <button
                      role="menuitem"
                      onClick={handleAddSticker}
                      className="text-body-md text-on-surface hover:bg-surface-container-highest flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors"
                    >
                      <Smile size={15} /> {t("sticker.addToStickers")}
                    </button>
                  )}
                  {onReport && (
                    <button
                      role="menuitem"
                      onClick={handleReport}
                      className="text-body-md text-on-surface hover:bg-surface-container-highest flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors"
                    >
                      <Flag size={15} /> {t("chat.message.report")}
                    </button>
                  )}
                  {showRecall && (
                    <button
                      role="menuitem"
                      onClick={handleRecall}
                      className="text-body-md text-error hover:bg-surface-container-highest flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors"
                    >
                      <Undo2 size={15} /> {t("chat.message.revoke")}
                    </button>
                  )}
                </div>,
                document.body,
              )}
          </div>
        </div>

        {/* 表情回应：点击气泡 toggle 自己的参与态 */}
        {msg.reactions && msg.reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {msg.reactions.map((r) => (
              <button
                key={r.emoji}
                onClick={() => onReact?.(r.emoji)}
                className={cn(
                  "text-label-md inline-flex h-6 items-center gap-1 rounded-full border px-2 transition-colors",
                  r.mine
                    ? "bg-primary-container text-primary-on-container border-transparent"
                    : "border-outline-variant bg-surface-container-high text-on-surface",
                )}
              >
                {r.emoji} {r.count}
              </button>
            ))}
          </div>
        )}

        {/* meta 行：时间 + 状态 */}
        <div
          className={cn(
            "text-label-sm text-on-surface-variant mt-1 flex items-center gap-1",
            isSelf && "justify-end",
          )}
        >
          {isSelf && msg.status === "failed" ? (
            // 失败重试做在 meta 行里：以前在气泡与头像之间插一个「!」按钮，
            // 会把这一行撑开、把气泡和头像顶得老远
            <button
              type="button"
              onClick={onRetry}
              className="text-error hover:bg-error/10 -mx-1 flex items-center gap-1 rounded px-1 transition-colors"
            >
              <RotateCcw size={11} aria-hidden />
              <span>{t("chat.status.failed")}</span>
              <span className="underline">{t("common.retry")}</span>
            </button>
          ) : (
            <>
              <span className="tabular-nums">{msg.time}</span>
              {msg.edited && <span className="opacity-65">· {t("chat.message.edited")}</span>}
              {isSelf && msg.status === "sending" && (
                <Loader2 size={12} className="animate-spin" aria-label={t("chat.status.sending")} />
              )}
              {isSelf && msg.status === "sent" && (
                <Check size={13} aria-label={t("chat.status.sent")} />
              )}
              {isSelf && msg.status === "read" && (
                <CheckCheck size={13} className="text-primary" aria-label={t("chat.status.read")} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * TypingIndicator — 正在输入指示气泡
 *
 * @description 三个跳动的圆点 + "xx 正在输入…" 提示，
 * 放在消息流末尾，prefers-reduced-motion 下动画自动关闭（全局样式接管）。
 */
export function TypingIndicator({ name }: { name: string }) {
  const { t } = useTranslation();
  return (
    <div className="mt-2 flex items-end gap-2.5">
      <Avatar name={name} size="md" />
      <div className="flex flex-col">
        <div className="msg-bubble-peer w-fit rounded-lg rounded-bl-sm px-3 py-2">
          <span className="flex items-center gap-1" aria-hidden>
            <i className="typing-dot" />
            <i className="typing-dot [animation-delay:0.2s]" />
            <i className="typing-dot [animation-delay:0.4s]" />
          </span>
        </div>
        <span className="text-label-sm text-on-surface-variant mt-1">
          {t("chat.typing", { name })}
        </span>
      </div>
    </div>
  );
}
