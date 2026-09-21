/**
 * InConversationSearch — 会话内消息搜索面板
 *
 * @description
 * 显示在 ChatWindow 标题栏下方，按关键词搜索当前会话内消息。
 * 点击结果触发 messageStore.seekToMessage 滚动定位并高亮目标消息。
 */
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
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
  conversationId: string;
  onClose: () => void;
}

export function InConversationSearch({ conversationId, onClose }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MessageSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekToMessage = useMessageStore((s) => s.seekToMessage);
  const setActive = useConversationStore((s) => s.setActive);

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
        const res = await searchMessages({ q, conversation_id: conversationId, limit: 20 });
        setResults(res.results);
      } catch (err) {
        captureException(err, { context: "InConversationSearch" });
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, conversationId]);

  const handleResultClick = async (r: MessageSearchResult) => {
    if (r.conversation_id !== conversationId) {
      setActive(r.conversation_id);
    }
    await seekToMessage(r.conversation_id, r.message_id, r.seq);
    onClose();
  };

  return (
    <div className="border-b border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
      <div className="mb-2 flex items-center gap-2">
        <input
          autoFocus
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("search.placeholder")}
          className="flex-1 rounded-lg bg-gray-100 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800"
        />
        <button
          onClick={onClose}
          aria-label={t("search.close")}
          className="rounded-lg p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <X size={16} />
        </button>
      </div>

      {loading && <p className="py-1 text-xs text-gray-400">{t("search.loading")}</p>}

      {!loading && query.trim().length >= 3 && results.length === 0 && (
        <p className="py-1 text-xs text-gray-400">{t("search.empty")}</p>
      )}

      {!loading && query.trim().length < 3 && query.trim().length > 0 && (
        <p className="py-1 text-xs text-gray-400">{t("search.hint")}</p>
      )}

      {results.length > 0 && (
        <ul className="max-h-48 space-y-0.5 overflow-y-auto">
          {results.map((r) => (
            <li key={r.message_id}>
              <button
                onClick={() => void handleResultClick(r)}
                className={cn(
                  "w-full rounded-lg px-2 py-1.5 text-left text-sm",
                  "transition-colors hover:bg-gray-100 dark:hover:bg-gray-800",
                )}
              >
                <p className="mb-0.5 text-xs text-gray-500 dark:text-gray-400">
                  {r.sender_nickname}
                </p>
                <p className="line-clamp-2 text-xs text-gray-900 dark:text-gray-100">{r.excerpt}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
