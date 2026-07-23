/**
 * SearchModal — 全局消息搜索浮层（Cmd/Ctrl+K 触发）
 *
 * @description
 * 全屏遮罩 + 居中搜索框，搜索所有用户有权限访问的会话中的消息。
 * 点击结果切换到目标会话并定位到该消息。
 */
import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  searchMessages,
  useMessageStore,
  useConversationStore,
  captureException,
} from "@yuanchat/shared";
import type { MessageSearchResult } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";

interface Props {
  show: boolean;
  onClose: () => void;
}

export function SearchModal({ show, onClose }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MessageSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const seekToMessage = useMessageStore((s) => s.seekToMessage);
  const setActive = useConversationStore((s) => s.setActive);

  useEffect(() => {
    if (show) {
      setQuery("");
      setResults([]);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [show]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 3) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await searchMessages({ q, limit: 20 });
        setResults(res.results);
      } catch (err) {
        captureException(err, { context: "SearchModal" });
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const handleResultClick = async (r: MessageSearchResult) => {
    setActive(r.conversation_id);
    await seekToMessage(r.conversation_id, r.message_id, r.seq);
    onClose();
  };

  if (!show) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("search.title")}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mx-4 w-full max-w-xl overflow-hidden rounded-lg bg-white shadow-lg dark:bg-gray-900">
        <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <Search size={18} className="shrink-0 text-gray-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("search.placeholder")}
            className="flex-1 bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400 dark:text-gray-100"
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
            }}
          />
          <button
            onClick={onClose}
            aria-label={t("search.close")}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X size={16} />
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {loading && <p className="px-4 py-3 text-sm text-gray-400">{t("search.loading")}</p>}

          {!loading && query.trim().length >= 3 && results.length === 0 && (
            <p className="px-4 py-3 text-sm text-gray-400">{t("search.empty")}</p>
          )}

          {!loading && query.trim().length > 0 && query.trim().length < 3 && (
            <p className="px-4 py-3 text-sm text-gray-400">{t("search.hint")}</p>
          )}

          {results.length > 0 && (
            <ul className="py-1">
              {results.map((r) => (
                <li key={r.message_id}>
                  <button
                    onClick={() => void handleResultClick(r)}
                    className={cn(
                      "w-full px-4 py-2.5 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800",
                    )}
                  >
                    <div className="mb-0.5 flex items-center gap-2">
                      <span className="truncate text-xs font-medium text-gray-500 dark:text-gray-400">
                        {r.conv_name}
                      </span>
                      <span className="text-xs text-gray-400">·</span>
                      <span className="truncate text-xs text-gray-400">{r.sender_nickname}</span>
                    </div>
                    <p className="line-clamp-2 text-sm text-gray-900 dark:text-gray-100">
                      {r.excerpt}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
