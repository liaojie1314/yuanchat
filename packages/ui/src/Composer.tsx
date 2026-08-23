/**
 * Composer 组件 — 消息输入区
 *
 * @description
 * 聊天窗口底部的统一输入面板（与原型 composer-box 一致的一体化卡片）：
 * - 引用回复条：显示被回复人与摘要，可取消
 * - 自适应高度 textarea（最高 160px），Enter 发送 / Shift+Enter 换行
 * - 工具条：图片 / 文件 / 表情 / 语音 / 更多
 * - 发送按钮：空内容禁用；聚焦时显示快捷键提示
 *
 * 移动端（compact 模式）收窄为单行圆角输入 + 环绕按钮，符合手机输入习惯。
 *
 * @param onSend - 发送回调，参数为去除首尾空白后的文本
 * @param compact - 移动端紧凑模式
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AtSign, Image as ImageIcon, Mic, Paperclip, Plus, Send, Smile, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  chatSocket,
  fetchMembers,
  isMockEnabled,
  quoteExcerptOf,
  useConversationStore,
  useMessageStore,
} from "@yuanchat/shared";
import type { ConversationMember, MentionRef } from "@yuanchat/shared";
import {
  cn,
  mentionSpanAfter,
  mentionSpanBefore,
  mentionTokenAfter,
  mentionTokenBefore,
  repairMentionDeletion,
} from "@yuanchat/shared/utils";
import { EmojiPicker } from "./EmojiPicker";
import { MentionPicker } from "./MentionPicker";
import { VoiceRecorderBar } from "./VoiceRecorderBar";

/** typing 帧节流间隔：输入期间最多每 3s 上报一次 */
const TYPING_THROTTLE_MS = 3000;

export function Composer({
  onSend,
  compact = false,
}: {
  /** 发送回调：text 为去除首尾空白后的正文，mentions 为收集到的 @ 用户 ID+昵称 */
  onSend: (text: string, mentions: MentionRef[]) => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [recording, setRecording] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const anyFileInputRef = useRef<HTMLInputElement>(null);
  const lastTypingSentRef = useRef(0);
  const replyingTo = useMessageStore((s) => s.replyingTo);
  const setReplyingTo = useMessageStore((s) => s.setReplyingTo);
  const composerInsert = useMessageStore((s) => s.composerInsert);
  const activeId = useConversationStore((s) => s.activeId);
  const activeConv = useConversationStore((s) => s.conversations.find((c) => c.id === s.activeId));
  const isGroup = activeConv?.type === "group";

  // 群成员按需拉取（仅群聊，供 @ 匹配）；activeId 变化时重拉
  const [members, setMembers] = useState<ConversationMember[]>([]);
  useEffect(() => {
    if (!isGroup || !activeId || isMockEnabled()) {
      setMembers([]);
      return;
    }
    let alive = true;
    void fetchMembers(activeId)
      .then((list) => {
        if (alive) setMembers(list);
      })
      .catch(() => {
        if (alive) setMembers([]);
      });
    return () => {
      alive = false;
    };
  }, [activeId, isGroup]);

  // 已选 @ 目标（提交时随 sendText 上送；用户删完 @ 昵称也顺带移出）
  const [pickedMentions, setPickedMentions] = useState<MentionRef[]>([]);
  // @ 触发：光标前的 @ 与其后未空白段为 query
  const [mentionQuery, setMentionQuery] = useState<{ start: number; query: string } | null>(null);
  // 选择器高亮下标：由 Composer 持有，键盘导航与 Enter 选中都在 handleKeyDown 里完成
  const [mentionActive, setMentionActive] = useState(0);
  const filteredMembers = useMemo(() => {
    if (!mentionQuery) return [];
    const q = mentionQuery.query.toLowerCase();
    return members.filter((m) => !q || m.nickname.toLowerCase().includes(q));
  }, [members, mentionQuery]);
  // 候选集变化后高亮回到首项（过滤后原下标可能已越界）
  useEffect(() => {
    setMentionActive(0);
  }, [filteredMembers]);
  // 可整体删除的提及昵称：已选提及 + 全体成员（手打的 @昵称 也当提及处理）
  const mentionNames = useMemo(() => {
    const names = pickedMentions.map((m) => m.name);
    members.forEach((m) => {
      if (names.indexOf(m.nickname) < 0) names.push(m.nickname);
    });
    return names;
  }, [members, pickedMentions]);

  const canSend = value.trim().length > 0;

  // 撤回重新编辑：composerInsert 非空 → 覆盖输入框值 + 聚焦，随即清空该字段
  useEffect(() => {
    if (composerInsert === null) return;
    setValue(composerInsert);
    useMessageStore.getState().setComposerInsert(null);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [composerInsert]);

  // 表情面板打开时，监听 document mousedown：点击面板外部即关闭
  // （面板根元素 onMouseDown 已 stopPropagation，故点内部不会触发）
  useEffect(() => {
    if (!showEmoji) return;
    const onDocMouseDown = () => setShowEmoji(false);
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [showEmoji]);

  /**
   * 开合表情面板。
   *
   * 开面板前先收键盘：安卓上表情面板与软键盘会同时占屏（面板是行内渲染的，
   * 键盘再顶起来就把输入行挤没了），二者必须互斥。
   */
  const toggleEmoji = () => {
    const next = !showEmoji;
    if (next) textareaRef.current?.blur();
    setShowEmoji(next);
  };

  /** 在光标处插入 emoji，并在下一帧恢复焦点与光标位置 */
  const insertEmoji = (emoji: string) => {
    const el = textareaRef.current;
    if (!el) {
      setValue((v) => v + emoji);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + emoji + value.slice(end);
    setValue(next);
    requestAnimationFrame(() => {
      // 移动端不抢焦点：面板还开着，聚焦会把软键盘一起顶上来
      if (!compact) el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  };

  /** 发送贴纸：调用 store.sendSticker，关闭面板 */
  const sendSticker = (sticker: {
    id: string;
    objectKey: string;
    width: number;
    height: number;
  }) => {
    if (!activeId) return;
    void useMessageStore.getState().sendSticker(activeId, sticker);
    setShowEmoji(false);
  };

  const notifyTyping = () => {
    if (!activeId || !chatSocket.isOpen()) return;
    const nowMs = Date.now();
    if (nowMs - lastTypingSentRef.current < TYPING_THROTTLE_MS) return;
    lastTypingSentRef.current = nowMs;
    chatSocket.send("typing", { conversation_id: activeId });
  };

  const send = () => {
    const text = value.trim();
    if (!text) return;
    // 只保留仍出现在正文里的 mentions（避免用户回删 @ 后仍上送）
    const alive = pickedMentions.filter((m) => text.includes("@" + m.name));
    onSend(text, alive);
    setValue("");
    setPickedMentions([]);
    setMentionQuery(null);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  /** 处理 textarea 输入：检测 @ 触发点 */
  const handleValueChange = (next: string) => {
    const el = textareaRef.current;
    // 安卓输入法的退格拦不下来（keydown 无按键信息、beforeinput 不可取消），
    // 删除已经发生，这里把被啃掉一角的 @提及残片补删干净
    if (isGroup && el) {
      const caretAfter = el.selectionStart ?? next.length;
      const repaired = repairMentionDeletion(value, next, caretAfter, mentionNames);
      if (repaired) {
        setValue(repaired.value);
        setMentionQuery(null);
        requestAnimationFrame(() => {
          el.focus();
          el.setSelectionRange(repaired.caret, repaired.caret);
          autoGrow(el);
        });
        return;
      }
    }
    setValue(next);
    if (!isGroup) return;
    const caret = el?.selectionStart ?? next.length;
    // 光标位置往前找最近的 @，空白截断
    let i = caret - 1;
    while (i >= 0 && next[i] !== "@" && !/\s/.test(next[i])) i--;
    if (i >= 0 && next[i] === "@") {
      const query = next.slice(i + 1, caret);
      // 已插入 mention 后的 @昵称 段不再弹（query 恰好命中一个已选昵称）
      if (!query.includes(" ")) {
        setMentionQuery({ start: i, query });
        return;
      }
    }
    setMentionQuery(null);
  };

  /** 选中 @ 目标：把 "@query" 替换成 "@昵称 " */
  const handlePickMention = (member: ConversationMember) => {
    if (!mentionQuery) return;
    const before = value.slice(0, mentionQuery.start);
    const after = value.slice(mentionQuery.start + 1 + mentionQuery.query.length);
    const inserted = "@" + member.nickname + " ";
    const next = before + inserted + after;
    setValue(next);
    setPickedMentions((prev) => {
      const dup = prev.some((m) => m.id === member.userId);
      return dup ? prev : [...prev, { id: member.userId, name: member.nickname }];
    });
    setMentionQuery(null);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const pos = before.length + inserted.length;
      el.setSelectionRange(pos, pos);
    });
  };

  /** 发送一张图片：交给 store 的 sendImage（乐观预览 → 压缩 → 上传 → WS 帧） */
  const sendImageFile = (file: File) => {
    if (!activeId) return;
    void useMessageStore.getState().sendImage(activeId, file);
  };

  /** 图片按钮选中文件：仅取图片类型，发送后清空 input 以便再次选同一文件 */
  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.indexOf("image/") === 0) sendImageFile(file);
    e.target.value = "";
  };

  /** 粘贴：剪贴板首个图片文件走图片发送路径（截图直接粘贴发图），阻止图片当文本插入 */
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const file = e.clipboardData?.files?.[0];
    if (file && file.type.indexOf("image/") === 0) {
      e.preventDefault();
      sendImageFile(file);
    }
  };

  /** 打开系统文件选择器（图片按钮 / 移动端回形针触发） */
  const openFilePicker = () => fileInputRef.current?.click();

  /** 打开任意文件选择器（回形针按钮） */
  const openAnyFilePicker = () => anyFileInputRef.current?.click();

  /** 回形针选中任意文件：图片走图片路径（压缩预览），其余走文件消息 */
  const handleAnyFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && activeId) {
      if (file.type.indexOf("image/") === 0) sendImageFile(file);
      else void useMessageStore.getState().sendFile(activeId, file);
    }
    e.target.value = "";
  };

  /** 隐藏的图片文件选择器（两种布局共用） */
  const fileInput = (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFilePick}
      />
      <input ref={anyFileInputRef} type="file" className="hidden" onChange={handleAnyFilePick} />
    </>
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // 选择器打开时上下键/Enter/Esc 归它消费：全部在这一个监听器里处理，
    // Enter 选人后必须 return，绝不能穿到下面的发送分支
    if (mentionQuery && filteredMembers.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionActive((i) => (i + 1) % filteredMembers.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionActive((i) => (i - 1 + filteredMembers.length) % filteredMembers.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        handlePickMention(filteredMembers[Math.min(mentionActive, filteredMembers.length - 1)]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }
    // @提及整体删除：光标紧邻 "@昵称" 时，一次退格/删除清掉整段（连尾随空格），
    // 而不是逐字符啃出 "@李" 这种发不出去的残片。
    // 正在敲 @query（选择器判定中）时不整体处理：此刻用户是在编辑昵称本身
    if (
      !mentionQuery &&
      (e.key === "Backspace" || e.key === "Delete") &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      textareaRef.current
    ) {
      const el = textareaRef.current;
      const caret = el.selectionStart ?? 0;
      if (caret === (el.selectionEnd ?? caret)) {
        const span =
          e.key === "Backspace"
            ? mentionSpanBefore(value, caret, mentionNames)
            : mentionSpanAfter(value, caret, mentionNames);
        if (span) {
          e.preventDefault();
          const next = value.slice(0, span.start) + value.slice(span.end);
          setValue(next);
          setMentionQuery(null);
          requestAnimationFrame(() => {
            el.focus();
            el.setSelectionRange(span.start, span.start);
            autoGrow(el);
          });
          return;
        }
      }
    }
    // @提及整体移动：左右方向键一次跨过整个 "@昵称"，光标不会停在昵称中间；
    // 按住 Shift 则整段一次纳入/退出选区。尾随空格仍是普通字符，单独走一步
    if (
      !mentionQuery &&
      (e.key === "ArrowLeft" || e.key === "ArrowRight") &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      textareaRef.current
    ) {
      const el = textareaRef.current;
      const selStart = el.selectionStart ?? 0;
      const selEnd = el.selectionEnd ?? selStart;
      // 选区的活动端：无选区时就是光标，有选区时按 selectionDirection 取
      const focus =
        selStart === selEnd ? selStart : el.selectionDirection === "backward" ? selStart : selEnd;
      const token =
        e.key === "ArrowLeft"
          ? mentionTokenBefore(value, focus, mentionNames)
          : mentionTokenAfter(value, focus, mentionNames);
      if (token) {
        e.preventDefault();
        const next = e.key === "ArrowLeft" ? token.start : token.end;
        if (e.shiftKey) {
          const anchor = selStart === selEnd ? focus : focus === selStart ? selEnd : selStart;
          el.setSelectionRange(
            Math.min(anchor, next),
            Math.max(anchor, next),
            next < anchor ? "backward" : "forward",
          );
        } else {
          el.setSelectionRange(next, next);
        }
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  /** 引用回复条（两种模式共用） */
  const replyBar = replyingTo && (
    <div className="border-primary bg-surface-container mb-2 flex items-center gap-2 rounded-lg border-l-[3px] px-3 py-2">
      <span className="text-body-sm min-w-0 flex-1 truncate">
        <span className="text-primary text-label-sm font-medium">
          {t("chat.reply.label", { name: replyingTo.senderName ?? "" })}
        </span>{" "}
        {/* 语音/贴纸引用此前一律显示"[图片]"，摘要口径与发送出去的 quote.excerpt 统一 */}
        {quoteExcerptOf(replyingTo)}
      </span>
      <button
        onClick={() => setReplyingTo(null)}
        aria-label={t("chat.reply.cancel")}
        className="md3-icon-btn text-on-surface-variant !h-7 !w-7"
      >
        <X size={14} />
      </button>
    </div>
  );

  /** 录音条（两种布局共用）：替换输入行，完成后交 store 发送 */
  const voiceBar = (
    <VoiceRecorderBar
      onDone={(blob, duration) => {
        setRecording(false);
        if (activeId) void useMessageStore.getState().sendVoice(activeId, blob, duration);
      }}
      onCancel={() => setRecording(false)}
    />
  );

  if (compact) {
    // 移动端：单行胶囊输入 + 附件/表情/发送
    if (recording) {
      return <div className="bg-surface-container-low shrink-0 px-2.5 pt-2 pb-3">{voiceBar}</div>;
    }
    return (
      <div className="bg-surface-container-low relative shrink-0 px-2.5 pt-2 pb-3">
        {mentionQuery && filteredMembers.length > 0 && (
          <div className="animate-slide-up absolute bottom-full left-2.5 z-20 mb-1 w-56">
            <MentionPicker
              members={filteredMembers}
              activeIndex={mentionActive}
              onActiveChange={setMentionActive}
              onPick={handlePickMention}
            />
          </div>
        )}
        {replyBar}
        <div className="flex items-end gap-1.5">
          <button
            onClick={openFilePicker}
            className="md3-icon-btn text-on-surface-variant"
            aria-label={t("chat.input.image")}
          >
            <ImageIcon size={20} />
          </button>
          <button
            onClick={openAnyFilePicker}
            className="md3-icon-btn text-on-surface-variant"
            aria-label={t("chat.input.file")}
          >
            <Paperclip size={20} />
          </button>
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            onChange={(e) => {
              handleValueChange(e.target.value);
              autoGrow(e.target);
              notifyTyping();
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            // 点输入框要打字 → 收表情面板（键盘要上来，二者互斥）
            onFocus={() => setShowEmoji(false)}
            placeholder={t("chat.input.placeholder")}
            aria-label={t("chat.input.placeholder")}
            className="bg-surface-container-high text-body-lg text-on-surface placeholder:text-on-surface-variant/70 max-h-28 min-w-0 flex-1 resize-none rounded-lg px-4 py-2.5 focus:outline-none"
          />
          <button
            className="md3-icon-btn text-on-surface-variant"
            aria-label={t("chat.input.emoji")}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={toggleEmoji}
          >
            <Smile size={20} />
          </button>
          {canSend ? (
            <button
              onClick={send}
              aria-label={t("chat.input.send")}
              className="brand-gradient flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white transition-transform active:scale-90"
            >
              <Send size={17} />
            </button>
          ) : (
            <button
              onClick={() => setRecording(true)}
              className="md3-icon-btn text-on-surface-variant"
              aria-label={t("chat.input.voice")}
            >
              <Mic size={20} />
            </button>
          )}
        </div>
        {/* 移动端：面板行内渲染在输入行下方，推高布局（不悬浮，规避安卓键盘 fixed 定位坑） */}
        {showEmoji && (
          <div className="animate-slide-up mt-2 h-72">
            <EmojiPicker
              compact
              onPick={insertEmoji}
              onClose={() => setShowEmoji(false)}
              onPickSticker={sendSticker}
            />
          </div>
        )}
        {fileInput}
      </div>
    );
  }

  // 桌面 / 平板：一体化输入卡片
  return (
    <div className="border-outline-variant bg-surface-container-low relative shrink-0 border-t px-3 pt-2.5 pb-3">
      {/* 桌面：面板浮层定位于输入卡片上方 */}
      {showEmoji && (
        <div className="animate-slide-up absolute bottom-full left-3 z-10 mb-1 h-72 w-80">
          <EmojiPicker
            onPick={insertEmoji}
            onClose={() => setShowEmoji(false)}
            onPickSticker={sendSticker}
          />
        </div>
      )}
      {mentionQuery && filteredMembers.length > 0 && (
        <div className="absolute bottom-full left-3 z-20 mb-1 w-64">
          <MentionPicker
            members={filteredMembers}
            activeIndex={mentionActive}
            onActiveChange={setMentionActive}
            onPick={handlePickMention}
          />
        </div>
      )}
      {replyBar}
      {recording ? (
        voiceBar
      ) : (
        <div className="border-outline-variant focus-within:border-primary focus-within:ring-primary/15 bg-surface-bright dark:bg-surface-container group rounded-lg border transition-shadow focus-within:ring-[3px]">
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            onChange={(e) => {
              handleValueChange(e.target.value);
              autoGrow(e.target);
              notifyTyping();
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={t("chat.input.placeholder")}
            aria-label={t("chat.input.placeholder")}
            className="text-body-lg text-on-surface placeholder:text-on-surface-variant/70 block max-h-40 w-full resize-none bg-transparent px-3.5 pt-3 pb-1 leading-relaxed focus:outline-none"
          />
          <div className="flex items-center gap-0.5 px-2 pb-1.5">
            <ToolButton label={t("chat.input.image")} onClick={openFilePicker}>
              <ImageIcon size={19} />
            </ToolButton>
            <ToolButton label={t("chat.input.file")} onClick={openAnyFilePicker}>
              <Paperclip size={19} />
            </ToolButton>
            <ToolButton label={t("chat.input.emoji")} onClick={toggleEmoji} active={showEmoji}>
              <Smile size={19} />
            </ToolButton>
            <ToolButton label={t("chat.input.voice")} onClick={() => setRecording(true)}>
              <Mic size={19} />
            </ToolButton>
            {isGroup && (
              <ToolButton
                label={t("chat.mention.trigger")}
                onClick={() => {
                  const el = textareaRef.current;
                  if (!el) return;
                  const pos = el.selectionStart ?? value.length;
                  handleValueChange(value.slice(0, pos) + "@" + value.slice(pos));
                  requestAnimationFrame(() => {
                    el.focus();
                    el.setSelectionRange(pos + 1, pos + 1);
                    // 手动触发 mention query（handleValueChange 已依赖 caret）
                    handleValueChange(el.value);
                  });
                }}
              >
                <AtSign size={19} />
              </ToolButton>
            )}
            <ToolButton label={t("chat.input.more")}>
              <Plus size={19} />
            </ToolButton>
            <span className="flex-1" />
            <span className="text-label-sm text-on-surface-variant mr-2 hidden opacity-0 transition-opacity duration-150 group-focus-within:opacity-70 sm:inline">
              {t("chat.input.hint")}
            </span>
            <button
              onClick={send}
              disabled={!canSend}
              aria-label={t("chat.input.send")}
              className={cn(
                "brand-gradient flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition-all",
                canSend
                  ? "hover:brightness-105 active:scale-90"
                  : "cursor-not-allowed opacity-40 grayscale-[0.3]",
              )}
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      )}
      {fileInput}
    </div>
  );
}

function ToolButton({
  label,
  onClick,
  active = false,
  children,
}: {
  label: string;
  onClick?: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      className={cn("md3-icon-btn !h-9 !w-9", active ? "text-primary" : "text-on-surface-variant")}
      aria-label={label}
      title={label}
      onMouseDown={onClick ? (e) => e.stopPropagation() : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
