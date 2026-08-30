/**
 * StickerMineView 页面 — 我发布的表情包
 *
 * @description
 * 路由 `/stickers/mine` 的实现（两端 app 各自包一层 page 壳）：
 * - 列表（封面 + 名称 + 贴纸数），每项提供「编辑」入口与「删除」操作
 * - 删除走 ConfirmDialog 二次确认（danger）：级联清理包内贴纸与所有用户的
 *   添加关系，属于发布者主动撤回内容，不可撤销
 * - 空态引导去发布；加载/错误态与商城列表同范式
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Loader2, PackageOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { captureException, deleteStickerPack, listMyPacks, showToast } from "@yuanchat/shared";
import type { MyPackItem } from "@yuanchat/shared";
import { StickerPackCover } from "./StickerPackCover";
import { ConfirmDialog } from "./ConfirmDialog";

export function StickerMineView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [packs, setPacks] = useState<MyPackItem[]>([]);
  const [state, setState] = useState<"loading" | "done" | "error">("loading");
  const [pendingDelete, setPendingDelete] = useState<MyPackItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const list = await listMyPacks();
      setPacks(list);
      setState("done");
    } catch (err) {
      captureException(err, { context: "StickerMineView.load" });
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, retryTick]);

  /** 删除我发布的包：确认后调接口，成功即从列表摘除 */
  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    try {
      await deleteStickerPack(pendingDelete.id);
      setPacks((prev) => prev.filter((p) => p.id !== pendingDelete.id));
      showToast("info", t("sticker.market.deleted"));
    } catch (err) {
      captureException(err, { context: "StickerMineView.delete" });
      showToast("error", t("sticker.market.deleteFailed"));
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };

  const goBack = () => navigate("/stickers");

  return (
    <div className="flex h-full flex-col">
      {/* 页头：返回 + 标题 + 发布入口 */}
      <header className="border-outline-variant bg-surface-container-low flex h-[60px] shrink-0 items-center gap-2 border-b px-3">
        <button
          type="button"
          onClick={goBack}
          aria-label={t("sticker.market.back")}
          className="text-on-surface-variant hover:bg-surface-container inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-title-md text-on-surface font-semibold">
          {t("sticker.market.myPacks")}
        </h1>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => navigate("/stickers/publish")}
          className="bg-primary text-on-primary text-label-lg inline-flex items-center gap-1 rounded-lg px-3 py-1.5 font-medium transition-opacity hover:opacity-90"
        >
          <Plus size={15} />
          {t("sticker.market.publish")}
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {state === "loading" && (
          <div className="flex h-32 items-center justify-center">
            <Loader2 size={20} className="text-primary animate-spin" />
          </div>
        )}

        {state === "error" && (
          <div className="flex h-64 flex-col items-center justify-center gap-2 text-sm">
            <PackageOpen size={32} className="text-on-surface-variant opacity-30" />
            <p className="text-on-surface-variant">{t("sticker.market.loadFailed")}</p>
            <button
              type="button"
              onClick={() => setRetryTick((n) => n + 1)}
              className="text-primary rounded-lg px-3 py-1 transition-colors hover:opacity-80"
            >
              {t("common.retry")}
            </button>
          </div>
        )}

        {state === "done" && packs.length === 0 && (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-sm">
            <PackageOpen size={32} className="text-on-surface-variant opacity-30" />
            <p className="text-on-surface-variant">{t("sticker.market.mineEmpty")}</p>
            <button
              type="button"
              onClick={() => navigate("/stickers/publish")}
              className="bg-primary text-on-primary rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
            >
              {t("sticker.market.goPublish")}
            </button>
          </div>
        )}

        {state === "done" && packs.length > 0 && (
          <ul className="divide-outline-variant divide-y">
            {packs.map((pack) => (
              <li
                key={pack.id}
                className="hover:bg-surface-container-low flex items-center gap-3 px-4 py-3"
              >
                <Link to={"/stickers/" + pack.id} className="shrink-0">
                  <StickerPackCover coverUrl={pack.cover_url} className="h-14 w-14" />
                </Link>
                <div className="min-w-0 flex-1">
                  <Link to={"/stickers/" + pack.id}>
                    <p className="text-body-lg text-on-surface truncate font-medium">{pack.name}</p>
                  </Link>
                  <p className="text-body-sm text-on-surface-variant">
                    {t("sticker.market.stickerCount", { count: pack.sticker_count })}
                  </p>
                </div>
                <Link
                  to={"/stickers/" + pack.id + "/edit"}
                  aria-label={t("sticker.market.edit")}
                  className="text-on-surface-variant hover:bg-surface-container inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors"
                >
                  <Pencil size={16} />
                </Link>
                <button
                  type="button"
                  onClick={() => setPendingDelete(pack)}
                  aria-label={t("sticker.market.deletePack")}
                  className="text-on-surface-variant hover:text-error inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 删除二次确认 */}
      <ConfirmDialog
        open={pendingDelete !== null}
        title={t("sticker.market.deletePack")}
        message={t("sticker.market.deletePackConfirm")}
        confirmLabel={t("common.delete")}
        danger
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
