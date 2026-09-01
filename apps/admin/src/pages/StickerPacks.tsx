/**
 * 表情包全量管理页 — 搜索、状态标志展示、下架/恢复上架/官方标识切换/放行
 */
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@yuanchat/ui";
import { cn } from "@yuanchat/shared/utils";
import {
  listStickerPacks,
  takedownPack,
  untakedownPack,
  setPackOfficial,
  clearPackFlag,
  type AdminStickerPack,
} from "../api";
import { usePagedQuery } from "../hooks/usePagedQuery";
import { SearchBox, DataTable, Pager, EmptyRow } from "../components/Table";

/** 表格加载骨架：若干行等高占位，避免布局跳动（CLS = 0） */
function SkeletonRows({ cols, rows = 5 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <tr key={i} className="border-b border-outline-variant last:border-0">
          {Array.from({ length: cols }, (_, j) => (
            <td key={j} className="px-4 py-3">
              <div className="h-4 w-3/4 animate-pulse rounded bg-surface-container-high" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** 状态徽标：flagged=敏感词命中（红）、taken_down=已下架（警示）、is_official=官方（主色） */
function StatusBadge({ tone, label }: { tone: "error" | "warn" | "primary"; label: string }) {
  return (
    <span
      className={cn(
        "mr-1 inline-block rounded px-1.5 py-0.5 text-label-sm",
        tone === "error" && "bg-error-container text-error-on-container",
        tone === "warn" && "bg-surface-container-highest text-on-surface-variant",
        tone === "primary" && "bg-primary-container text-primary-on-container",
      )}
    >
      {label}
    </span>
  );
}

export function StickerPacksPage() {
  const { t } = useTranslation();
  const fetcher = useCallback((_q: string, p: number) => listStickerPacks(_q, p), []);
  const { q, search, page, setPage, list, total, totalPages, loading, refresh } =
    usePagedQuery<AdminStickerPack>(fetcher);

  // 破坏性 / 状态切换动作统一走确认框：pending 状态记录待操作目标与动作类型
  const [pending, setPending] = useState<{
    pack: AdminStickerPack;
    action: "takedown" | "untakedown" | "setOfficial" | "unsetOfficial";
  } | null>(null);

  const headers = [
    t("admin.moderation.colPack"),
    t("admin.moderation.colOwner"),
    t("admin.stickerPacks.colStatus"),
    t("admin.moderation.colStickers"),
    t("admin.messages.colTime"),
    t("admin.users.colActions"),
  ];

  // 确认框文案按动作显式映射（i18n 静态检查要求字面量 key）
  const CONFIRM_KEYS: Record<
    NonNullable<typeof pending>["action"],
    { title: string; message: string; danger: boolean }
  > = {
    takedown: {
      title: t("admin.stickerPacks.takedown"),
      message: t("admin.stickerPacks.takedownConfirm"),
      danger: true,
    },
    untakedown: {
      title: t("admin.stickerPacks.untakedown"),
      message: t("admin.stickerPacks.untakedownConfirm"),
      danger: false,
    },
    setOfficial: {
      title: t("admin.stickerPacks.setOfficial"),
      message: t("admin.stickerPacks.setOfficialConfirm"),
      danger: false,
    },
    unsetOfficial: {
      title: t("admin.stickerPacks.unsetOfficial"),
      message: t("admin.stickerPacks.unsetOfficialConfirm"),
      danger: false,
    },
  };
  const confirmMeta = pending ? CONFIRM_KEYS[pending.action] : null;

  const runPending = () => {
    if (!pending) return;
    const { pack, action } = pending;
    setPending(null);
    if (action === "takedown") void takedownPack(pack.id).then(refresh);
    else if (action === "untakedown") void untakedownPack(pack.id).then(refresh);
    else if (action === "setOfficial") void setPackOfficial(pack.id, true).then(refresh);
    else void setPackOfficial(pack.id, false).then(refresh);
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-title-lg font-semibold text-on-surface">
          {t("admin.nav.stickerPacks")}
        </h1>
        <SearchBox
          value={q}
          onChange={search}
          placeholder={t("admin.stickerPacks.searchPlaceholder")}
        />
      </div>

      <DataTable headers={headers}>
        {loading && <SkeletonRows cols={headers.length} />}
        {!loading && list.length === 0 && <EmptyRow colSpan={headers.length} />}
        {!loading &&
          list.map((p) => (
            <tr
              key={p.id}
              className="border-b border-outline-variant last:border-0 hover:bg-surface-container-low"
            >
              <td className="max-w-md px-4 py-3 text-body-md text-on-surface">
                <p className="line-clamp-2">{p.name}</p>
              </td>
              <td className="px-4 py-3 text-body-md text-on-surface-variant">
                {p.owner_name ??
                  t(p.is_official ? "sticker.market.byOfficial" : "sticker.market.deletedUser")}
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                {p.is_official && (
                  <StatusBadge tone="primary" label={t("admin.stickerPacks.badgeOfficial")} />
                )}
                {p.flagged && (
                  <StatusBadge tone="error" label={t("admin.stickerPacks.badgeFlagged")} />
                )}
                {p.taken_down && (
                  <StatusBadge tone="warn" label={t("admin.stickerPacks.badgeTakenDown")} />
                )}
                {!p.is_official && !p.flagged && !p.taken_down && (
                  <span className="text-label-md text-on-surface-variant">
                    {t("admin.stickerPacks.statusNormal")}
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-body-md text-on-surface-variant">{p.sticker_count}</td>
              <td className="whitespace-nowrap px-4 py-3 text-body-md text-on-surface-variant">
                {new Date(p.created_at).toLocaleString()}
              </td>
              <td className="space-x-3 whitespace-nowrap px-4 py-3">
                {p.flagged && (
                  <button
                    onClick={() => void clearPackFlag(p.id).then(refresh)}
                    className="text-label-lg text-primary hover:underline"
                  >
                    {t("admin.moderation.approve")}
                  </button>
                )}
                {p.taken_down ? (
                  <button
                    onClick={() => setPending({ pack: p, action: "untakedown" })}
                    className="text-label-lg text-primary hover:underline"
                  >
                    {t("admin.stickerPacks.untakedown")}
                  </button>
                ) : (
                  <button
                    onClick={() => setPending({ pack: p, action: "takedown" })}
                    className="text-label-lg text-error hover:underline"
                  >
                    {t("admin.moderation.takedown")}
                  </button>
                )}
                {p.is_official ? (
                  <button
                    onClick={() => setPending({ pack: p, action: "unsetOfficial" })}
                    className="text-label-lg text-on-surface-variant hover:underline"
                  >
                    {t("admin.stickerPacks.unsetOfficial")}
                  </button>
                ) : (
                  <button
                    onClick={() => setPending({ pack: p, action: "setOfficial" })}
                    className="text-label-lg text-primary hover:underline"
                  >
                    {t("admin.stickerPacks.setOfficial")}
                  </button>
                )}
              </td>
            </tr>
          ))}
      </DataTable>
      <Pager page={page} totalPages={totalPages} total={total} onPage={setPage} />

      <ConfirmDialog
        open={pending !== null}
        title={confirmMeta?.title ?? ""}
        message={confirmMeta?.message ?? ""}
        danger={confirmMeta?.danger}
        onConfirm={runPending}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
