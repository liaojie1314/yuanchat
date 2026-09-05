/**
 * Composer 组件 — 消息输入区
 *
 * @description
 * 聊天窗口底部的统一输入面板（与原型 composer-box 一致的一体化卡片）：
 * - 引用回复条：显示被回复人与摘要，可取消
 * - 自适应高度 textarea（最高 160px），Enter 发送 / Shift+Enter 换行
 * - 工具条：图片 / 视频 / 文件 / 表情 / 语音 / 更多
 * - 发送按钮：空内容禁用；聚焦时显示快捷键提示
 *
 * 移动端（compact 模式）改为两行：上行「输入框 + 发送」，下行工具条，
 * 低频动作（文件 / 媒体相册 / 语音通话 / 视频通话）收进「更多」宫格面板。
 *
 * @param onSend - 发送回调，参数为去除首尾空白后的文本
 * @param compact - 移动端紧凑模式
 * @param onOpenMedia - 打开会话媒体相册（移动端由「更多」面板触发，桌面端仍在顶栏）
 * @param editingMessageId - 非空即编辑态：顶部出提示条、发送按钮语义变「保存」、提交改走 onSaveEdit
 * @param onCancelEdit - 退出编辑态（提示条的取消按钮与 Esc 键触发）
 * @param onSaveEdit - 保存编辑（编辑态下替代 onSend；回车与发送按钮两条入口都走这里）
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AtSign,
  Image as ImageIcon,
  Images,
  Mic,
  Paperclip,
  Phone,
  Plus,
  Send,
  Smile,
  Video,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  chatSocket,
  fetchMembers,
  isMockEnabled,
  quoteExcerptOf,
  showToast,
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

/**
 * 按内容同步 textarea 高度（上限 160px，超出后内部滚动）。
 *
 * @param el - 目标 textarea
 * @remarks 放模块级而非组件内：它只吃传入的元素、不读组件状态，
 *   组件内的话每次 render 都是新函数，effect 里用它就得进依赖数组。
 */
function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
}

export function Composer({
  onSend,
  compact = false,
  onOpenMedia,
  editingMessageId,
  onCancelEdit,
  onSaveEdit,
}: {
  /** 发送回调：text 为去除首尾空白后的正文，mentions 为收集到的 @ 用户 ID+昵称 */
  onSend: (text: string, mentions: MentionRef[]) => void;
  compact?: boolean;
  /** 打开媒体相册（移动端「更多」面板入口；缺省时该项不渲染） */
  onOpenMedia?: () => void;
  /** 非空表示编辑态：显示提示条，发送按钮语义变「保存」 */
  editingMessageId?: string | null;
  /** 取消编辑 */
  onCancelEdit?: () => void;
  /** 保存编辑（编辑态下替代 onSend） */
  onSaveEdit?: (text: string) => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [recording, setRecording] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const anyFileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
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

  // 撤回重新编辑 / 进入编辑态：composerInsert 非空 → 覆盖输入框值 + 聚焦，随即清空该字段
  useEffect(() => {
    if (composerInsert === null) return;
    setValue(composerInsert);
    useMessageStore.getState().setComposerInsert(null);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      // 光标必须显式移到末尾：程序化 setValue 后 focus 会把光标留在 0，
      // 用户接着打字变成「往原文前面插」（安卓真机实测：输入 -EDITED 得到
      // -EDITEDandroid-edit-orig）。取 composerInsert.length 而非 el.value.length，
      // 不依赖 React 提交时序。
      el.setSelectionRange(composerInsert.length, composerInsert.length);
      // 送进来的原文可能是多行：高度只随 onChange 长大，不同步这一次就停在一行，
      // 用户得在一行高的框里滚动着改；清空（编辑退出）时同理要缩回去
      autoGrow(el);
    });
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
    if (next) {
      textareaRef.current?.blur();
      setShowMore(false); // 表情与「更多」两个面板占同一块位置，互斥
    }
    setShowEmoji(next);
  };

  /** 开合「更多」宫格面板（与表情面板互斥，同样先收键盘） */
  const toggleMore = () => {
    const next = !showMore;
    if (next) {
      textareaRef.current?.blur();
      setShowEmoji(false);
    }
    setShowMore(next);
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
    // 编辑态：回车与发送按钮共用这一个出口，必须整条改走保存，
    // 否则会出现「按钮能保存、回车却发出一条新消息」。清空输入框交给父层
    // （保存成功与失败都要退出编辑态，由父层统一收口）
    if (editingMessageId) {
      onSaveEdit?.(text);
      return;
    }
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

  /** 打开视频选择器（仅文件选择，不含录制——录制另有独立能力，本批不做） */
  const openVideoPicker = () => videoInputRef.current?.click();

  /**
   * 视频按钮选中文件：交给 store 的 sendVideo（乐观预览 → 抽帧 → 双次直传 → WS 帧）。
   *
   * @remarks 时长/体积闸门在 store 里（重试同一条路径），此处不重复判断。
   */
  const handleVideoPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && activeId) {
      void useMessageStore.getState().sendVideo(activeId, file);
    }
    // 清空 value，才能再次选同一个文件
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
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={handleVideoPick}
      />
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
    // 编辑态 Esc 退出（@ 选择器打开时 Esc 归它消费，上面那段已经 return 了）
    if (e.key === "Escape" && editingMessageId) {
      e.preventDefault();
      onCancelEdit?.();
      return;
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

  /** 编辑态提示条（两种布局共用）：说明正在编辑 + 取消入口 */
  const editingBar = editingMessageId && (
    <div
      data-testid="composer-editing-hint"
      className="border-primary bg-surface-container text-label-md text-on-surface-variant mb-2 flex items-center justify-between gap-2 rounded-lg border-l-[3px] px-3 py-2"
    >
      <span>{t("chat.message.editing")}</span>
      <button
        type="button"
        data-testid="composer-cancel-edit"
        onClick={onCancelEdit}
        className="text-primary font-medium"
      >
        {t("chat.message.editCancel")}
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
    // 移动端：两行布局 —— 上行「输入框 + 发送」，下行工具条（图标均分）。
    //
    // 早先是六个控件（图片/视频/文件/输入框/表情/语音）挤在同一行：390px 宽的机型上
    // 输入框只剩百来像素，中文两行就顶到 max-h。把工具移到独立一行后输入框可以整宽，
    // 图标之间也有了可点面积（44px 触达区不再互相挤压）。
    if (recording) {
      return <div className="bg-surface-container-low shrink-0 px-2.5 pt-2 pb-3">{voiceBar}</div>;
    }
    return (
      <div className="bg-surface-container-low relative shrink-0 px-2.5 pt-2 pb-2">
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
        {editingBar}
        {replyBar}
        <div className="flex items-end gap-2">
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
            // 点输入框要打字 → 收起两个面板（键盘要上来，三者互斥）
            onFocus={() => {
              setShowEmoji(false);
              setShowMore(false);
            }}
            placeholder={t("chat.input.placeholder")}
            aria-label={t("chat.input.placeholder")}
            className="bg-surface-container-high text-body-lg text-on-surface placeholder:text-on-surface-variant/70 max-h-28 min-w-0 flex-1 resize-none rounded-lg px-4 py-2.5 focus:outline-none"
          />
          {/* 发送按钮常驻：位置固定下来，不再与语音按钮抢同一个槽位（否则一打字按钮就换脸） */}
          <button
            onClick={send}
            disabled={!canSend}
            aria-label={editingMessageId ? t("chat.message.editSave") : t("chat.input.send")}
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white transition-transform",
              canSend ? "brand-gradient active:scale-90" : "bg-outline-variant",
            )}
          >
            <Send size={17} />
          </button>
        </div>
        {/* 工具条：高频四项常驻（语音 / 图片 / 表情 / 更多），其余收进「更多」面板 */}
        <div className="mt-1 flex items-center justify-around">
          <button
            onClick={() => setRecording(true)}
            className="md3-icon-btn text-on-surface-variant"
            aria-label={t("chat.input.voice")}
          >
            <Mic size={21} />
          </button>
          <button
            onClick={openFilePicker}
            className="md3-icon-btn text-on-surface-variant"
            aria-label={t("chat.input.image")}
          >
            <ImageIcon size={21} />
          </button>
          <button
            onClick={openVideoPicker}
            className="md3-icon-btn text-on-surface-variant"
            aria-label={t("chat.input.video")}
            data-testid="send-video"
          >
            <Video size={21} />
          </button>
          <button
            className={cn("md3-icon-btn", showEmoji ? "text-primary" : "text-on-surface-variant")}
            aria-label={t("chat.input.emoji")}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={toggleEmoji}
          >
            <Smile size={21} />
          </button>
          <button
            className={cn("md3-icon-btn", showMore ? "text-primary" : "text-on-surface-variant")}
            aria-label={t("chat.input.more")}
            data-testid="composer-more"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={toggleMore}
          >
            <Plus size={21} />
          </button>
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
        {/* 「更多」宫格：低频动作从顶栏与工具条收拢到这里（顶栏在手机上只留返回/标题/详情）。
            高度与表情面板一致（h-72）：两者切换时输入行不跳动，键盘顶起的高度也一致。 */}
        {showMore && (
          <div className="animate-slide-up mt-2 h-72 overflow-y-auto">
            <div className="grid grid-cols-4 gap-2 pt-2">
              <MoreItem
                icon={<Paperclip size={22} />}
                label={t("chat.input.file")}
                onClick={() => {
                  setShowMore(false);
                  openAnyFilePicker();
                }}
              />
              {onOpenMedia && (
                <MoreItem
                  icon={<Images size={22} />}
                  label={t("media.title")}
                  testId="more-media"
                  onClick={() => {
                    setShowMore(false);
                    onOpenMedia();
                  }}
                />
              )}
              <MoreItem
                icon={<Phone size={22} />}
                label={t("chat.voiceCall")}
                onClick={() => showToast("info", t("common.comingSoon"))}
              />
              <MoreItem
                icon={<Video size={22} />}
                label={t("chat.videoCall")}
                onClick={() => showToast("info", t("common.comingSoon"))}
              />
            </div>
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
      {editingBar}
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
            <ToolButton label={t("chat.input.video")} onClick={openVideoPicker} testId="send-video">
              <Video size={19} />
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
              aria-label={editingMessageId ? t("chat.message.editSave") : t("chat.input.send")}
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
  testId,
  children,
}: {
  label: string;
  onClick?: () => void;
  active?: boolean;
  /** 可选测试锚点：文案会与顶栏按钮重名时（如「视频」）按 testid 定位更稳 */
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      className={cn("md3-icon-btn !h-9 !w-9", active ? "text-primary" : "text-on-surface-variant")}
      aria-label={label}
      title={label}
      data-testid={testId}
      onMouseDown={onClick ? (e) => e.stopPropagation() : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * 移动端「更多」宫格里的一格：图标方块 + 文字标签。
 *
 * @param icon - lucide 图标节点
 * @param label - 标签文案（同时作为 aria-label，图标本身对读屏无意义）
 * @param onClick - 点击回调
 * @param testId - 可选测试锚点
 */
function MoreItem({
  icon,
  label,
  onClick,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      data-testid={testId}
      className="flex flex-col items-center gap-1.5 py-1"
    >
      <span className="bg-surface-container-high text-on-surface-variant flex h-14 w-14 items-center justify-center rounded-lg transition-transform active:scale-95">
        {icon}
      </span>
      <span className="text-label-sm text-on-surface-variant">{label}</span>
    </button>
  );
}
