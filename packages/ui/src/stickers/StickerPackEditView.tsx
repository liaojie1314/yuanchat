/**
 * StickerPackEditView 页面 — 编辑我发布的表情包（仅发布者）
 *
 * @description
 * 路由 `/stickers/:packId/edit` 的实现（两端 app 各自包一层 page 壳）：
 * - 改名：就地编辑 + 保存（PATCH，仅提交变更字段）
 * - 贴纸管理：从包中移除（不删原收藏）；两个来源追加——收藏多选（已在包内的
 *   项排除且不可点）与直传新图（上传即收藏，再以 collection 来源入包）
 * - 换封面：在包内贴纸中点选，即点即传（复制一份到 sticker-covers/ 后 PATCH）
 *
 * 非发布者直链进入时展示无权提示（服务端同样会拒绝，前端只做引导）。
 */
import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useBackTo } from "../util/useBackTo";
import { useTranslation } from "react-i18next";
import { ArrowLeft, PackageOpen, X } from "lucide-react";
import {
  addStickerToPack,
  captureException,
  getPackDetail,
  listMyStickers,
  removeStickerFromPack,
  showToast,
  updateStickerPack,
} from "@yuanchat/shared";
import type { PackDetail, StickerItem } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";
import { StickerThumb } from "./StickerThumb";
import { StickerSourcePicker } from "./StickerSourcePicker";
import { uploadStickerCover } from "./stickerUpload";

const NAME_MAX = 64;

export function StickerPackEditView({ packId }: { packId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // 系统返回键与页面内返回箭头同语义，不落「非根页面回聊天页」的兜底
  useBackTo(`/stickers/${packId}`);
  const location = useLocation();

  const [detail, setDetail] = useState<PackDetail | null>(null);
  const [state, setState] = useState<"loading" | "done" | "error">("loading");
  // 改名草稿；与 detail.pack.name 的差异决定保存按钮可用性
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [myStickers, setMyStickers] = useState<StickerItem[]>([]);
  const [changingCover, setChangingCover] = useState(false);
  const [mutatingStickerId, setMutatingStickerId] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const [d, favs] = await Promise.all([getPackDetail(packId), listMyStickers()]);
      setDetail(d);
      setNameDraft(d.pack.name);
      setMyStickers(favs);
      setState("done");
    } catch (err) {
      captureException(err, { context: "StickerPackEditView.load" });
      setState("error");
    }
  }, [packId]);

  useEffect(() => {
    void load();
  }, [load, retryTick]);

  const goBack = () => {
    if (location.key !== "default") navigate(-1);
    else navigate("/stickers", { replace: true });
  };

  /** 改名：仅在有差异时提交；成功后同步本地 detail */
  const saveName = async () => {
    if (!detail) return;
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === detail.pack.name || savingName) return;
    setSavingName(true);
    try {
      const next = await updateStickerPack(packId, { name: trimmed });
      setDetail(next);
      showToast("info", t("sticker.market.saveSuccess"));
    } catch (err) {
      captureException(err, { context: "StickerPackEditView.saveName" });
      showToast("error", t("sticker.market.saveFailed"));
    } finally {
      setSavingName(false);
    }
  };

  /** 从包中移除一张贴纸：本地先行，失败回滚（不影响原收藏） */
  const removeFromPack = async (stickerId: string) => {
    if (!detail || mutatingStickerId) return;
    setMutatingStickerId(stickerId);
    const snapshot = detail;
    setDetail({
      ...detail,
      stickers: detail.stickers.filter((s) => s.id !== stickerId),
      pack: { ...detail.pack, sticker_count: Math.max(0, detail.pack.sticker_count - 1) },
    });
    try {
      await removeStickerFromPack(packId, stickerId);
    } catch (err) {
      captureException(err, { context: "StickerPackEditView.removeFromPack" });
      setDetail(snapshot);
      showToast("error", t("sticker.market.removeFailed"));
    } finally {
      setMutatingStickerId(null);
    }
  };

  /**
   * 追加贴纸（收藏来源）：成功后回读包详情，用服务端真身替换网格内容。
   *
   * @remarks 服务端对 collection 来源是「复制出新行」（新 id、同 object_key），
   * 收藏行的 id 在包内并不存在——若直接把收藏项乐观并入 detail.stickers，
   * 之后的「从包移除」会拿收藏 id 打 DELETE 而恒 404。所以这里不用乐观 id：
   * POST 成功后立即 getPackDetail 对齐服务端状态。
   */
  const addFromCollection = async (sticker: StickerItem) => {
    if (!detail) return;
    try {
      await addStickerToPack(packId, { source: "collection", sticker_id: sticker.id });
    } catch (err) {
      captureException(err, { context: "StickerPackEditView.addFromCollection" });
      showToast("error", t("sticker.market.addFailed"));
      return;
    }
    try {
      setDetail(await getPackDetail(packId));
    } catch (err) {
      // 追加已成功，仅详情回读失败：下次进入页面会自动对齐，不打断用户
      captureException(err, { context: "StickerPackEditView.reloadAfterAdd" });
    }
  };

  /** 直传新图：先收藏再入包（与发布页同一条 collection 通道） */
  const handleUploaded = (sticker: StickerItem) => {
    setMyStickers((prev) => [sticker].concat(prev));
    void addFromCollection(sticker);
  };

  /** 换封面：即点即传（复制源贴纸到 sticker-covers/ 后 PATCH） */
  const changeCover = async (sticker: StickerItem) => {
    if (changingCover) return;
    setChangingCover(true);
    try {
      const cover = await uploadStickerCover(sticker.object_key, sticker.width, sticker.height);
      const next = await updateStickerPack(packId, {
        cover_object_key: cover.objectKey,
        cover_width: cover.width,
        cover_height: cover.height,
      });
      setDetail(next);
      showToast("info", t("sticker.market.saveSuccess"));
    } catch (err) {
      captureException(err, { context: "StickerPackEditView.changeCover" });
      showToast("error", t("sticker.market.saveFailed"));
    } finally {
      setChangingCover(false);
    }
  };

  const nameDirty =
    detail != null && nameDraft.trim() !== detail.pack.name && nameDraft.trim() !== "";

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
        <h1 className="text-title-md text-on-surface font-semibold">{t("sticker.market.edit")}</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {state === "loading" && (
          <div className="p-4">
            <div className="bg-surface-container-high h-10 w-full animate-pulse rounded-lg" />
            <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
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

        {state === "done" && detail && !detail.pack.is_owner && (
          <div className="flex h-64 flex-col items-center justify-center gap-2 text-sm">
            <p className="text-on-surface-variant">{t("sticker.market.notOwner")}</p>
            <button
              type="button"
              onClick={goBack}
              className="text-primary rounded-lg px-3 py-1 transition-colors hover:opacity-80"
            >
              {t("sticker.market.back")}
            </button>
          </div>
        )}

        {state === "done" && detail && detail.pack.is_owner && (
          <div className="mx-auto max-w-2xl p-4">
            {/* 改名 */}
            <label
              htmlFor="sticker-pack-edit-name"
              className="text-label-lg text-on-surface-variant mb-1 block"
            >
              {t("sticker.market.nameLabel")}
            </label>
            <div className="flex gap-2">
              <input
                id="sticker-pack-edit-name"
                type="text"
                value={nameDraft}
                maxLength={NAME_MAX}
                onChange={(e) => setNameDraft(e.target.value)}
                className="border-outline-variant bg-surface-container-low text-on-surface focus:border-primary min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
              />
              <button
                type="button"
                onClick={() => void saveName()}
                disabled={!nameDirty || savingName}
                className="bg-primary text-on-primary text-label-lg rounded-lg px-4 py-2 font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {t("common.save")}
              </button>
            </div>

            {/* 包内贴纸（可移除） */}
            <h2 className="text-title-sm text-on-surface mt-5 mb-2 font-medium">
              {t("sticker.market.stickerCount", { count: detail.pack.sticker_count })}
            </h2>
            {detail.stickers.length === 0 ? (
              <p className="text-body-sm text-on-surface-variant py-2">
                {t("sticker.market.emptyPack")}
              </p>
            ) : (
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 md:grid-cols-8">
                {detail.stickers.map((st) => (
                  <div
                    key={st.id}
                    className={cn(
                      "bg-surface-container-low relative grid aspect-square place-items-center rounded-lg p-1",
                      mutatingStickerId === st.id && "opacity-40",
                    )}
                  >
                    <StickerThumb objectKey={st.object_key} />
                    <button
                      type="button"
                      disabled={mutatingStickerId !== null}
                      aria-label={t("sticker.market.removeSticker")}
                      onClick={() => void removeFromPack(st.id)}
                      className="bg-surface-container-high text-on-surface-variant hover:text-error shadow-elevation-1 absolute -top-1 -right-1 grid h-5 w-5 place-items-center rounded-full transition-colors"
                    >
                      <X size={12} strokeWidth={2.5} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* 追加贴纸（已在包内的收藏项排除） */}
            <h2 className="text-title-sm text-on-surface mt-5 mb-2 font-medium">
              {t("sticker.market.addStickers")}
            </h2>
            <StickerSourcePicker
              stickers={myStickers}
              selectedIds={[]}
              excludedKeys={detail.stickers.map((s) => s.object_key)}
              onToggle={(id) => {
                const st = myStickers.find((s) => s.id === id);
                if (st) void addFromCollection(st);
              }}
              onUploaded={handleUploaded}
              onUploadStart={() => setMutatingStickerId("uploading")}
              onUploadEnd={() => setMutatingStickerId(null)}
            />

            {/* 换封面（从包内贴纸选，即点即换） */}
            {detail.stickers.length > 0 && (
              <>
                <h2 className="text-title-sm text-on-surface mt-5 mb-1 font-medium">
                  {t("sticker.market.cover")}
                </h2>
                <p className="text-body-sm text-on-surface-variant mb-2">
                  {t("sticker.market.coverHint")}
                </p>
                <div
                  className={cn(
                    "grid grid-cols-4 gap-1.5 sm:grid-cols-6 md:grid-cols-8",
                    changingCover && "pointer-events-none opacity-60",
                  )}
                >
                  {detail.stickers.map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      aria-label={t("sticker.market.setAsCover")}
                      onClick={() => void changeCover(st)}
                      className="bg-surface-container-low hover:ring-primary grid aspect-square place-items-center rounded-lg p-1 transition-colors hover:ring-2"
                    >
                      <StickerThumb objectKey={st.object_key} />
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
