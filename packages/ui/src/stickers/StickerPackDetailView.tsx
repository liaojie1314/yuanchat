/**
 * StickerPackDetailView 页面 — 表情包详情
 *
 * @description
 * 路由 `/stickers/:packId` 的实现（两端 app 各自包一层 page 壳）：
 * - 封面 + 名称 + 发布者 + 贴纸网格预览（复用 StickerThumb）
 * - 「添加 / 已添加」按钮：幂等切换，已添加态点击即移除
 * - 举报入口（target_type=sticker_pack，复用 ConfirmDialog 二次确认）
 * - is_owner 时显示「编辑」入口；owner_name 为 null 时按 is_official 区分
 *   官方出品 / 已注销用户
 * - 返回按钮：项目首例 URL 路由列表→详情，有历史栈时 navigate(-1)（与浏览器
 *   后退行为一致），深链直达时回退到商城列表
 */
import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useStickerBack } from "./useStickerBack";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Flag, PackageOpen, Pencil } from "lucide-react";
import {
  addStickerPack,
  captureException,
  getPackDetail,
  removeStickerPack,
  reportStickerPack,
  showToast,
} from "@yuanchat/shared";
import type { PackDetail } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";
import { StickerPackCover } from "./StickerPackCover";
import { StickerThumb } from "./StickerThumb";
import { packOwnerText } from "./stickerPackUtils";
import { ConfirmDialog } from "../primitives/ConfirmDialog";

/** 详情拉取状态：loading / done / error（404 也归入 error 展示重试外的文案） */
type LoadState = "loading" | "done" | "error";

export function StickerPackDetailView({ packId }: { packId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // 系统返回键与页面内返回箭头同语义，不落「非根页面回聊天页」的兜底
  useStickerBack("/stickers");
  const location = useLocation();
  const [detail, setDetail] = useState<PackDetail | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [reportOpen, setReportOpen] = useState(false);
  // 添加/移除与举报提交进行中标记，防止重复提交
  const [busy, setBusy] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const d = await getPackDetail(packId);
      setDetail(d);
      setState("done");
    } catch (err) {
      captureException(err, { context: "StickerPackDetailView.load" });
      setState("error");
    }
  }, [packId]);

  useEffect(() => {
    void load();
  }, [load, retryTick]);

  /** 返回：SPA 内跳转过来时后退一格（与浏览器后退一致），深链直达时回商城列表 */
  const goBack = () => {
    if (location.key !== "default") navigate(-1);
    else navigate("/stickers", { replace: true });
  };

  /** 添加/移除幂等切换：本地先行，失败回滚并提示 */
  const toggleAdded = async () => {
    if (!detail || busy) return;
    setBusy(true);
    const snapshot = detail;
    const next = { ...detail, added: !detail.added };
    setDetail(next);
    try {
      if (detail.added) await removeStickerPack(packId);
      else await addStickerPack(packId);
    } catch (err) {
      captureException(err, { context: "StickerPackDetailView.toggleAdded" });
      setDetail(snapshot);
      showToast(
        "error",
        t(detail.added ? "sticker.market.removeFailed" : "sticker.market.addFailed"),
      );
    } finally {
      setBusy(false);
    }
  };

  const submitReport = async () => {
    if (!detail) return;
    setReportOpen(false);
    try {
      await reportStickerPack(packId);
      showToast("info", t("report.submitted"));
    } catch (err) {
      captureException(err, { context: "StickerPackDetailView.report" });
      showToast("error", t("report.failed"));
    }
  };

  const isOwner = detail?.pack.is_owner === true;

  return (
    <div className="flex h-full flex-col">
      {/* 页头：返回 + 标题 */}
      <header className="border-outline-variant bg-surface-container-low flex h-[60px] shrink-0 items-center gap-2 border-b px-3">
        <button
          type="button"
          onClick={goBack}
          aria-label={t("sticker.market.back")}
          className="text-on-surface-variant hover:bg-surface-container inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-title-md text-on-surface truncate font-semibold">
          {detail ? detail.pack.name : t("sticker.market.title")}
        </h1>
        <div className="flex-1" />
        {isOwner && (
          <button
            type="button"
            onClick={() => navigate("/stickers/" + packId + "/edit")}
            className="text-label-lg text-primary hover:bg-primary/10 inline-flex items-center gap-1 rounded-lg px-3 py-1.5 transition-colors"
          >
            <Pencil size={15} />
            {t("sticker.market.edit")}
          </button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {state === "loading" && (
          <div className="p-4">
            <div className="flex gap-4">
              <div className="bg-surface-container-high h-24 w-24 shrink-0 animate-pulse rounded-lg" />
              <div className="flex-1 space-y-2 pt-1">
                <div className="bg-surface-container-high h-5 w-1/3 animate-pulse rounded" />
                <div className="bg-surface-container-high h-4 w-1/4 animate-pulse rounded" />
              </div>
            </div>
            <div className="mt-6 grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
              {Array.from({ length: 8 }, (_, i) => (
                <div
                  key={i}
                  className="bg-surface-container-high aspect-square w-full animate-pulse rounded-lg"
                />
              ))}
            </div>
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

        {state === "done" && detail && (
          <div className="p-4">
            {/* 概要区 */}
            <div className="flex gap-4">
              <StickerPackCover
                coverUrl={detail.pack.cover_url}
                fallbackKey={detail.pack.first_sticker_key}
                className="h-24 w-24"
              />
              <div className="min-w-0 flex-1">
                <h2 className="text-title-lg text-on-surface truncate font-semibold">
                  {detail.pack.name}
                </h2>
                <p className="text-body-md text-on-surface-variant mt-1">
                  {packOwnerText(detail.pack, t)}
                </p>
                <p className="text-body-sm text-on-surface-variant mt-0.5">
                  {t("sticker.market.stickerCount", { count: detail.pack.sticker_count })}
                </p>
              </div>
            </div>

            {/* 操作区 */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {!isOwner && (
                <button
                  type="button"
                  onClick={() => void toggleAdded()}
                  disabled={busy}
                  className={cn(
                    "text-label-lg rounded-lg px-4 py-2 font-medium transition-opacity disabled:opacity-50",
                    detail.added
                      ? "bg-surface-container-high text-on-surface hover:opacity-90"
                      : "bg-primary text-on-primary hover:opacity-90",
                  )}
                >
                  {detail.added ? t("sticker.market.added") : t("sticker.market.add")}
                </button>
              )}
              {!isOwner && (
                <button
                  type="button"
                  onClick={() => setReportOpen(true)}
                  className="text-label-lg text-on-surface-variant hover:bg-surface-container inline-flex items-center gap-1.5 rounded-lg px-3 py-2 transition-colors"
                >
                  <Flag size={15} />
                  {t("sticker.market.report")}
                </button>
              )}
            </div>

            {/* 贴纸预览网格 */}
            <div className="mt-5 grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
              {detail.stickers.map((st) => (
                <div
                  key={st.id}
                  className="bg-surface-container-low grid aspect-square place-items-center rounded-lg p-1.5"
                >
                  <StickerThumb objectKey={st.object_key} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 举报二次确认 */}
      <ConfirmDialog
        open={reportOpen}
        title={t("sticker.market.report")}
        message={t("sticker.market.reportConfirm")}
        confirmLabel={t("sticker.market.report")}
        onConfirm={() => void submitReport()}
        onCancel={() => setReportOpen(false)}
      />
    </div>
  );
}
