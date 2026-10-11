/**
 * 管理端通用 UI 片段：搜索框、数据表、分页条、加载骨架
 */
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";

/**
 * 列表页检索框（受控）。
 *
 * @param value - 当前检索词
 * @param onChange - 检索词变化回调（防抖由 usePagedQuery 负责）
 * @param placeholder - 占位文案
 */
export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="flex w-80 items-center gap-2 rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2">
      <Search size={16} className="shrink-0 text-on-surface-variant" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-transparent text-body-md text-on-surface outline-none placeholder:text-on-surface-variant"
      />
    </div>
  );
}

/**
 * 数据表外壳：表头固定由 headers 渲染，行内容由调用方以 `<tr>` 传入。
 *
 * @param headers - 列标题（已翻译），列数以它为准
 * @param children - tbody 内容：骨架行 / 空行 / 数据行
 */
export function DataTable({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-outline-variant">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-outline-variant bg-surface-container-low">
            {headers.map((h) => (
              <th key={h} className="px-4 py-3 text-label-md font-medium text-on-surface-variant">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/**
 * 分页条：总数 + 上一页 / 下一页。
 *
 * @param page - 当前页码（从 1 起）
 * @param totalPages - 总页数（至少 1）
 * @param total - 记录总数
 * @param onPage - 翻页回调
 */
export function Pager({
  page,
  totalPages,
  total,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between pt-4">
      <span className="text-label-md text-on-surface-variant">
        {t("admin.common.total", { count: total })}
      </span>
      <div className="flex items-center gap-2">
        <button
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className="rounded-lg border border-outline-variant px-3 py-1.5 text-label-lg text-on-surface hover:bg-surface-container disabled:opacity-40"
        >
          {t("admin.common.prev")}
        </button>
        <span className="text-label-md text-on-surface-variant">
          {page} / {totalPages}
        </span>
        <button
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          className="rounded-lg border border-outline-variant px-3 py-1.5 text-label-lg text-on-surface hover:bg-surface-container disabled:opacity-40"
        >
          {t("admin.common.next")}
        </button>
      </div>
    </div>
  );
}

/**
 * 表格加载骨架行 — 所有列表页首屏加载期的占位。
 *
 * 占位条与真实单元格共用 `px-4 py-3` 与 `text-body-md`，条高由一个 `&nbsp;`
 * 的行盒自然撑出：不写死 px，字号 / 行高（含 `--font-scale`）怎么变，
 * 骨架行高都恒等于真实单行行高。真实内容是两行的页面（如用户页的
 * 昵称 + 元聊号）传 `lines={2}` 对齐。
 *
 * `rows` 默认 20，即列表页的分页 size：满页数据时骨架与真实表格等高，
 * 位移为零。不足一页时骨架更高，被顶到首屏之外的分页条回落不计入 CLS；
 * 反过来（骨架矮、数据到达把可见的分页条向下顶）才是真正的跳动，
 * 所以宁可高不可矮。
 *
 * @param cols - 列数，直接传 headers.length
 * @param rows - 占位行数，默认 20（与列表页 size 对齐）
 * @param lines - 单行内的文本行数，默认 1
 */
export function SkeletonRows({
  cols,
  rows = 20,
  lines = 1,
}: {
  cols: number;
  rows?: number;
  lines?: number;
}) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} aria-hidden="true" className="border-b border-outline-variant last:border-0">
          {Array.from({ length: cols }, (_, c) => (
            <td key={c} className="px-4 py-3 text-body-md">
              {Array.from({ length: lines }, (_, l) => (
                <div key={l} className="w-3/4 animate-pulse rounded bg-surface-container-high">
                  &nbsp;
                </div>
              ))}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/**
 * 空状态行（加载结束且无数据时渲染）。
 *
 * @param colSpan - 跨列数，传 headers.length
 */
export function EmptyRow({ colSpan }: { colSpan: number }) {
  const { t } = useTranslation();
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-body-md text-on-surface-variant">
        {t("common.noData")}
      </td>
    </tr>
  );
}
