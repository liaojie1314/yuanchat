/**
 * CommandPalette — 命令面板与全局搜索（Cmd/Ctrl+K）。
 *
 * @description
 * **一个组件两种模式**：输入为空时是命令面板（动作注册表 + 最近会话），
 * 一旦输入就进搜索（三源并发 + 分组结果 + 类型筛选）。
 * K3 与 K18 合并实现 —— 两者都要改这个组件，分两次做第二次得先拆掉第一次的结构。
 *
 * 桌面端刻意**不开独立原生窗口**而是放大面板：Tauri 每个 WebviewWindow 是独立
 * JS 上下文，store 不共享，联系人与会话列表得重新拉，每个快捷动作还要一轮跨窗口
 * RPC；而面板的全部价值在于对主窗口做事。用户的抱怨是「屏幕再大也只有一个窄弹窗」，
 * 那是宽度问题，断点就能解。详见设计文档 §1.2。
 *
 * 断点形态：mobile 全屏 / tablet 560px / desktop 720×560。
 * 断点一律内部 useBreakpoint() 推导，不接 isDesktop prop（沿用裁决 D1）。
 */
import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  X,
  FileText,
  Film,
  ImageOff,
  Music,
  RotateCw,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  searchMessages,
  resolveObjectUrl,
  useAuthStore,
  useContactStore,
  useConversationStore,
  useMessageStore,
  useThemeStore,
  useBreakpoint,
  useIsDesktop,
  captureException,
} from "@yuanchat/shared";
import type { MessageSearchResponse, MessageSearchResult, SearchType } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";
import { Avatar } from "../primitives/Avatar";
import { fileIconOf } from "../util/fileIcon";
import { buildPaletteActions } from "./paletteActions";
import type { PaletteContext } from "./paletteActions";

interface Props {
  /** 是否打开；由宿主（MainLayout 的 Ctrl/Cmd+K 监听）驱动 */
  show: boolean;
  /** 关闭回调（Escape / 遮罩点击 / 关闭按钮 / 选中条目后） */
  onClose: () => void;
}

/** 面板里一个可执行条目 —— 各分组共用的最小单元，扁平化后供键盘连续导航 */
interface PaletteEntry {
  /** 渲染 key，跨分组唯一 */
  key: string;
  /** 主文案（单行截断） */
  title: string;
  /** 次文案（单行截断，可无） */
  subtitle?: string;
  /** 行首 40×40 视觉位 */
  lead: React.ReactNode;
  /** 执行该条目 */
  run: () => void;
}

/** 结果分组：空分组不渲染标题 */
interface PaletteGroup {
  /** aria-label 与组标题共用的 i18n key */
  labelKey: string;
  entries: PaletteEntry[];
}

/** 类型筛选条的档位 key（"all" 不对应任何 SearchType） */
type TypeFilterKey = "all" | SearchType;

/**
 * 类型筛选条 → searchMessages 的 types 参数。
 *
 * 「全部」刻意不带 types 字段：searchMessages 对空数组与省略同义，
 * 但省略能让 URL 少一个参数，也和后端「不传即不过滤」的口径一致。
 */
const TYPE_FILTERS: { key: TypeFilterKey; labelKey: string; types?: SearchType[] }[] = [
  { key: "all", labelKey: "palette.filterAll" },
  { key: "text", labelKey: "palette.filterMessages", types: ["text"] },
  { key: "file", labelKey: "palette.filterFiles", types: ["file"] },
  { key: "image", labelKey: "palette.filterImages", types: ["image"] },
  { key: "video", labelKey: "palette.filterVideos", types: ["video"] },
  { key: "voice", labelKey: "palette.filterVoice", types: ["voice"] },
];

/** 走真实缩略图的消息类型：2 图片 / 8 贴纸（都是可渲染进 <img> 的图） */
const IMAGE_LIKE_TYPES = new Set([2, 8]);

/** settle() 的结果：与 Promise.allSettled 的 PromiseSettledResult 同构（ES2019 lib 没有该类型） */
type Settled<T> = { status: "fulfilled"; value: T } | { status: "rejected"; reason: unknown };

/**
 * 把任意值/承诺包成「必定兑现」的结果 —— 与 Promise.allSettled 同语义。
 *
 * 刻意不用字面的 Promise.allSettled：它是 ES2020 运行时 API（Chrome 76+），
 * 本仓的目标 WebView 是 Chrome 74，语法转译救不了内置方法（与
 * shared/polyfills.ts 开头注释同一坑位）；与其给三个 tsconfig 抬 lib 再补
 * 运行时 polyfill，不如 6 行包装把语义原样落地，ES2019 引擎零风险。
 */
function settle<T>(value: T | Promise<T>): Promise<Settled<T>> {
  return Promise.resolve(value).then(
    (v) => ({ status: "fulfilled" as const, value: v }),
    (reason) => ({ status: "rejected" as const, reason }),
  );
}

/**
 * 与后端同口径的字符数（[]rune 计数）：GIN 索引要求关键词至少 3 个字符，
 * JS 的 string.length 会把代理对算成 2，这里统一按码点数。
 */
function runeLength(s: string): number {
  return Array.from(s).length;
}

/** 文件名 → 小写扩展名（无扩展名返回空串，fileIconOf 会兜底通用图标） */
function extOf(fileName?: string): string {
  const name = fileName ?? "";
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** 行首通用图标位：固定 40×40（与缩略图同尺寸，行高稳定零 CLS） */
function IconBox({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="bg-surface-container-high text-on-surface-variant flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
      <Icon size={18} />
    </span>
  );
}

/**
 * 40×40 固定尺寸缩略图盒。
 *
 * 零 CLS 是硬要求：容器**永远**占 40×40，内部先渲染 animate-pulse 骨架，
 * 媒体 onLoad / onLoadedData 之后才渲染真实内容，异步解码不会把行高撑一下。
 * 视频走 { cache: false }：视频本体不进本地媒体缓存（体积不可控）。
 * 签名/加载失败降级为图标 —— 缩略图是增强，失败不能拖垮整行。
 */
function ThumbBox({ result, isVideo }: { result: MessageSearchResult; isVideo: boolean }) {
  const key = result.object_key ?? "";
  const [url, setUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setUrl(null);
    setLoaded(false);
    setFailed(false);
    resolveObjectUrl(key, isVideo ? { cache: false } : undefined)
      .then((u) => {
        if (alive) setUrl(u);
      })
      .catch(() => {
        // 缩略图取 URL 失败：保留骨架，交给 onError/降级路径，不上报（避免刷屏）
      });
    return () => {
      alive = false;
    };
  }, [key, isVideo]);

  const ready = url !== null && loaded && !failed;
  return (
    <span className="bg-surface-container-high relative h-10 w-10 shrink-0 overflow-hidden rounded-lg">
      {/* 骨架与真实内容同盒叠放：内容就绪前骨架兜底，尺寸不变 */}
      {!ready && !failed && <span className="absolute inset-0 animate-pulse" aria-hidden="true" />}
      {failed ? (
        <span className="text-on-surface-variant absolute inset-0 flex items-center justify-center">
          {isVideo ? <Film size={18} /> : <ImageOff size={18} />}
        </span>
      ) : isVideo ? (
        <video
          src={url ?? undefined}
          muted
          preload="metadata"
          onLoadedData={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn("h-full w-full object-cover", ready ? "block" : "hidden")}
        />
      ) : (
        <img
          src={url ?? undefined}
          alt=""
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn("h-full w-full object-cover", ready ? "block" : "hidden")}
        />
      )}
    </span>
  );
}

/** 按消息类型挑行首视觉位：图/贴纸/有 key 的视频走缩略图，文件走类型图标，其余兜底 */
function ResultLead({ result }: { result: MessageSearchResult }) {
  const type = result.message_type;
  const hasKey = !!result.object_key;
  if ((IMAGE_LIKE_TYPES.has(type) || type === 5) && hasKey) {
    return <ThumbBox result={result} isVideo={type === 5} />;
  }
  if (type === 3) {
    const { Icon, bg } = fileIconOf(extOf(result.file_name));
    return (
      <span
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white",
          bg,
        )}
      >
        <Icon size={18} />
      </span>
    );
  }
  if (type === 4) return <IconBox icon={Music} />;
  if (type === 5) return <IconBox icon={Film} />;
  if (IMAGE_LIKE_TYPES.has(type)) return <IconBox icon={ImageOff} />;
  return <IconBox icon={FileText} />;
}

/** 搜索加载骨架：3 条固定高度行（40×40 头 + 两行文本条），行高与真实结果一致 */
function SkeletonRows() {
  return (
    <div className="px-4 py-2" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 py-2">
          <div className="bg-surface-container-high h-10 w-10 shrink-0 animate-pulse rounded-lg" />
          <div className="flex-1 space-y-1.5">
            <div className="bg-surface-container-high h-3 w-1/3 animate-pulse rounded" />
            <div className="bg-surface-container-high h-3 w-2/3 animate-pulse rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * 命令面板组件。
 *
 * @param props.show 打开状态
 * @param props.onClose 关闭回调
 */
export function CommandPalette({ show, onClose }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toggleTheme = useThemeStore((s) => s.toggleMode);
  const logout = useAuthStore((s) => s.logout);
  const isDesktopApp = useIsDesktop();
  const bp = useBreakpoint();

  // 搜索模式的本地过滤走 getState() 快照（搜索是瞬时动作，不需要响应式重跑）；
  // 命令模式的「最近会话」需要跟随列表变化，才订阅 conversations
  const conversations = useConversationStore((s) => s.conversations);
  const setActive = useConversationStore((s) => s.setActive);
  const seekToMessage = useMessageStore((s) => s.seekToMessage);

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilterKey>("all");
  const [contactEntries, setContactEntries] = useState<PaletteEntry[]>([]);
  const [groupEntries, setGroupEntries] = useState<PaletteEntry[]>([]);
  const [messageEntries, setMessageEntries] = useState<PaletteEntry[]>([]);
  const [fileEntries, setFileEntries] = useState<PaletteEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState(false);
  const [selected, setSelected] = useState(0);
  const [retryTick, setRetryTick] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  /** 过期响应守卫：只让最后一次搜索落地（防抖 + 筛选切换 + 重试都可能并发） */
  const seqRef = useRef(0);
  /** 上一次发起搜索的查询词：区分「查询变了要防抖」与「筛选/重试变了立即刷」 */
  const lastQueryRef = useRef("");

  const ctx: PaletteContext = { navigate, toggleTheme, logout, isDesktopApp };
  const allActions = buildPaletteActions(ctx);

  /** 落到目标会话：store 置活跃 + 路由进 /chat/:id + 关面板 */
  const openConversation = (convId: string) => {
    setActive(convId);
    navigate(`/chat/${convId}`);
    onClose();
  };

  /** 联系人内存过滤（本地源一）：昵称包含查询词即命中 */
  const filterContactEntries = (needle: string): PaletteEntry[] => {
    const n = needle.toLowerCase();
    return useContactStore
      .getState()
      .friends.filter((f) => f.nickname.toLowerCase().includes(n))
      .map((f) => ({
        key: `contact-${f.id}`,
        title: f.nickname,
        lead: <Avatar name={f.nickname} src={f.avatarUrl} size="sm" />,
        run: () => {
          if (f.conversationId) {
            openConversation(f.conversationId);
          } else {
            // 还没建单聊的好友（历史脏数据 conversationId=null）：去通讯录找 TA
            navigate("/contacts");
            onClose();
          }
        },
      }));
  };

  /** 群聊内存过滤（本地源二）：群名包含查询词即命中 */
  const filterGroupEntries = (needle: string): PaletteEntry[] => {
    const n = needle.toLowerCase();
    return useConversationStore
      .getState()
      .conversations.filter((c) => c.type === "group" && c.name.toLowerCase().includes(n))
      .map((c) => ({
        key: `group-${c.id}`,
        title: c.name,
        subtitle: c.lastMessage,
        lead: <Avatar name={c.name} src={c.avatarUrl} size="sm" />,
        run: () => openConversation(c.id),
      }));
  };

  /** 服务端结果按类型拆组：1 文本 → 消息，其余（图/文件/语音/视频/贴纸）→ 文件与媒体 */
  const splitServerEntries = (results: MessageSearchResult[]) => {
    const messages: PaletteEntry[] = [];
    const files: PaletteEntry[] = [];
    for (const r of results) {
      const entry: PaletteEntry = {
        key: `msg-${r.message_id}`,
        title: r.message_type === 1 ? r.excerpt : r.file_name || r.excerpt,
        subtitle: `${r.conv_name} · ${r.sender_nickname}`,
        lead: <ResultLead result={r} />,
        run: () => {
          openConversation(r.conversation_id);
          // 落到会话后定位该消息（高亮滚动）；刻意不 await，别让定位阻塞关面板
          void seekToMessage(r.conversation_id, r.message_id, r.seq);
        },
      };
      if (r.message_type === 1) messages.push(entry);
      else files.push(entry);
    }
    setMessageEntries(messages);
    setFileEntries(files);
  };

  // ── 打开时重置（沿用 SearchModal 的既有行为）：清空 query/结果/筛选并聚焦 ──
  useEffect(() => {
    if (!show) return;
    setQuery("");
    setTypeFilter("all");
    setSelected(0);
    setLoading(false);
    setServerError(false);
    setContactEntries([]);
    setGroupEntries([]);
    setMessageEntries([]);
    setFileEntries([]);
    seqRef.current += 1; // 作废上一次打开遗留的在途请求
    lastQueryRef.current = "";
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [show]);

  // ── 搜索主流程：查询变化防抖 300ms；类型筛选/重试变化立即重查 ──
  // 依赖刻意只列驱动搜索的状态；entry 构造器捕获的 navigate/onClose/setActive
  // 行为稳定（onClose 恒为「关面板」），不需要触发重搜。
  useEffect(() => {
    if (!show) return;
    const trimmed = query.trim();

    if (!trimmed) {
      // 命令模式：清空搜索态
      setContactEntries([]);
      setGroupEntries([]);
      setMessageEntries([]);
      setFileEntries([]);
      setLoading(false);
      setServerError(false);
      setSelected(0);
      lastQueryRef.current = "";
      return;
    }

    const queryChanged = lastQueryRef.current !== trimmed;
    lastQueryRef.current = trimmed;
    const delay = queryChanged ? 300 : 0;

    const timer = setTimeout(() => {
      const seq = ++seqRef.current;
      // 后端 GIN 索引要求 ≥3 个字符（[]rune 口径），短查询只搜本地
      const needServer = runeLength(trimmed) >= 3;
      if (needServer) setLoading(true);
      setServerError(false);
      setSelected(0);

      const activeTypes = TYPE_FILTERS.find((f) => f.key === typeFilter)?.types;

      // 三源并发：本地两源是同步过滤包成已决 Promise，服务端源可能失败 ——
      // 逐源 settle 后 Promise.all 等价 allSettled：服务端挂了不该把本地联系人结果一起丢掉
      void Promise.all([
        settle(filterContactEntries(trimmed)),
        settle(filterGroupEntries(trimmed)),
        settle(
          needServer
            ? searchMessages({ q: trimmed, types: activeTypes, limit: 20 })
            : (null as MessageSearchResponse | null),
        ),
      ]).then(([c, g, s]) => {
        if (seq !== seqRef.current) return; // 已有更新一次的搜索落地，丢弃过期响应
        setContactEntries(c.status === "fulfilled" ? c.value : []);
        setGroupEntries(g.status === "fulfilled" ? g.value : []);
        if (s.status === "fulfilled") {
          splitServerEntries(s.value?.results ?? []);
          setServerError(false);
        } else {
          captureException(s.reason, { context: "CommandPalette" });
          setMessageEntries([]);
          setFileEntries([]);
          setServerError(true);
        }
        setLoading(false);
      });
    }, delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, typeFilter, retryTick, show]);

  // ── 命令模式的两组条目 ──
  const actionEntries: PaletteEntry[] = allActions.map((a) => ({
    key: `action-${a.id}`,
    title: t(a.labelKey),
    lead: <a.icon size={18} className="text-on-surface-variant shrink-0" />,
    run: () => a.run(ctx),
  }));
  const recentEntries: PaletteEntry[] = conversations.slice(0, 6).map((c) => ({
    key: `recent-${c.id}`,
    title: c.name,
    subtitle: c.lastMessage,
    lead: <Avatar name={c.name} src={c.avatarUrl} size="sm" />,
    run: () => openConversation(c.id),
  }));

  const inSearch = query.trim().length > 0;
  const groups: PaletteGroup[] = inSearch
    ? [
        { labelKey: "palette.groupContacts", entries: contactEntries },
        { labelKey: "palette.groupGroups", entries: groupEntries },
        // 服务端分组在加载中先不渲染（骨架行顶位），避免旧查询的结果闪回
        { labelKey: "palette.groupMessages", entries: loading ? [] : messageEntries },
        { labelKey: "palette.groupFiles", entries: loading ? [] : fileEntries },
      ]
    : [
        { labelKey: "palette.actions", entries: actionEntries },
        { labelKey: "palette.recent", entries: recentEntries },
      ];

  // 跨分组的扁平可选项序列：键盘 ↑↓ 在它上面连续移动
  const flat: PaletteEntry[] = groups.flatMap((g) => g.entries);
  const indexOf = new Map(flat.map((e, i) => [e.key, i] as const));
  // flat 变短时把选中索引夹回合法区间，避免 aria-activedescendant 指向不存在的项
  const current = Math.min(selected, Math.max(flat.length - 1, 0));

  // 选中项滚动进可视区（block:nearest 不打断用户当前的浏览位置）
  useEffect(() => {
    const el = document.getElementById(`${listId}-opt-${current}`);
    // jsdom 未实现 scrollIntoView，缺方法时静默跳过
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
  }, [current, listId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => Math.min(Math.min(i, flat.length - 1) + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => Math.max(Math.min(i, flat.length - 1) - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      flat[current]?.run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  if (!show) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("palette.placeholder")}
      className={cn(
        "fixed inset-0 z-50 flex justify-center bg-black/40",
        bp === "mobile" ? "items-stretch" : "items-start pt-[10vh]",
      )}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={cn(
          "bg-surface shadow-elevation-2 flex min-h-0 flex-col overflow-hidden",
          bp === "mobile"
            ? "h-full w-full rounded-none"
            : bp === "tablet"
              ? "mx-4 max-h-[70vh] w-[560px] rounded-lg"
              : "h-[560px] w-[720px] rounded-lg",
        )}
      >
        {/* 输入区 —— combobox 三件套：aria-expanded / aria-controls / aria-activedescendant */}
        <div className="border-outline-variant flex shrink-0 items-center gap-2 border-b px-4 py-3">
          <Search size={18} className="text-on-surface-variant shrink-0" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={flat.length > 0 ? `${listId}-opt-${current}` : undefined}
            aria-autocomplete="list"
            aria-label={t("palette.placeholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("palette.placeholder")}
            className="text-on-surface placeholder:text-on-surface-variant flex-1 bg-transparent text-sm outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label={t("search.close")}
            className="text-on-surface-variant hover:bg-surface-container-high rounded-lg p-1"
          >
            <X size={16} />
          </button>
        </div>

        {/* 类型筛选条：仅搜索模式出现，筛选变化立即重查（不走防抖） */}
        {inSearch && (
          <div className="border-outline-variant flex shrink-0 gap-1.5 overflow-x-auto border-b px-3 py-2">
            {TYPE_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={typeFilter === f.key}
                onClick={() => setTypeFilter(f.key)}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1 text-xs transition-colors",
                  typeFilter === f.key
                    ? "bg-primary text-on-primary"
                    : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest",
                )}
              >
                {t(f.labelKey)}
              </button>
            ))}
          </div>
        )}

        {/* 服务端失败的可重试提示：本地结果照常展示，只在列表上方补一行 */}
        {serverError && (
          <button
            type="button"
            onClick={() => setRetryTick((n) => n + 1)}
            className="text-error hover:bg-error/10 flex shrink-0 items-center justify-center gap-1.5 px-4 py-2 text-sm"
          >
            <RotateCw size={14} />
            {t("palette.searchFailed")}
          </button>
        )}

        {/* 结果列表：role=listbox；选项是跨分组的扁平序列，id 供 activedescendant 指认 */}
        <div role="listbox" id={listId} className="min-h-0 flex-1 overflow-y-auto py-1">
          {groups.map((g) =>
            g.entries.length === 0 ? null : (
              <div key={g.labelKey} role="group" aria-label={t(g.labelKey)}>
                <p className="text-on-surface-variant px-4 pt-2 pb-1 text-xs">{t(g.labelKey)}</p>
                {g.entries.map((entry) => {
                  const idx = indexOf.get(entry.key) ?? 0;
                  return (
                    <div
                      key={entry.key}
                      id={`${listId}-opt-${idx}`}
                      role="option"
                      aria-selected={idx === current}
                      onClick={entry.run}
                      className={cn(
                        "mx-2 flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2",
                        idx === current
                          ? "bg-surface-container-high"
                          : "hover:bg-surface-container-high",
                      )}
                    >
                      {entry.lead}
                      <span className="min-w-0 flex-1">
                        <span className="text-on-surface block truncate text-sm">
                          {entry.title}
                        </span>
                        {entry.subtitle && (
                          <span className="text-on-surface-variant block truncate text-xs">
                            {entry.subtitle}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            ),
          )}
          {loading && <SkeletonRows />}
          {!loading && inSearch && !serverError && flat.length === 0 && (
            <p className="text-on-surface-variant px-4 py-6 text-center text-sm">
              {t("palette.empty")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
