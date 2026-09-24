/**
 * 管理端通用 UI 片段：搜索框、数据表、分页条
 */
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";

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
