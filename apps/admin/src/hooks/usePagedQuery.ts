/**
 * usePagedQuery — 分页列表加载 hook（搜索词防抖 300ms、翻页、手动刷新）
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Page } from "../api";

export function usePagedQuery<T>(
  fetcher: (q: string, page: number) => Promise<Page<T>>,
  size = 20,
  // 额外重载信号：值变化时重新加载（如会话类型 tab），解决
  // fetcher 引用不稳定无法直接进依赖的问题
  version: unknown = 0,
) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [list, setList] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // fetcher 每次 render 都是新引用，存 ref 避免依赖它导致 effect 重跑
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  const load = useCallback(async (query: string, p: number) => {
    setLoading(true);
    try {
      const res = await fetcherRef.current(query, p);
      setList(res.list);
      setTotal(res.total);
    } catch {
      setList([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void load(q, page), q ? 300 : 0);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q, page, load, version]);

  const search = (next: string) => {
    setQ(next);
    setPage(1);
  };
  const refresh = () => void load(q, page);
  const totalPages = Math.max(1, Math.ceil(total / size));

  return { q, search, page, setPage, list, total, totalPages, loading, refresh };
}
