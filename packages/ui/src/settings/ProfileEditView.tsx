/**
 * ProfileEditView — 个人资料编辑视图
 *
 * @description
 * 设置页「个人资料」内容区：头像（Camera 角标点击换头像：选图 → 中心裁方 512 →
 * 预签名直传 avatars → updateProfile 即时刷新，上传中转圈遮罩）、昵称、
 * 个性签名、性别三选一，底部保存按钮（busy 防重入，成功/失败局部 toast）。
 *
 * 三端共用：desktop/tablet 内联于右内容区，mobile 栈式推入（外层 SettingsScreen
 * 提供返回头）。保存走 authStore.updateProfile → PUT /users/me。
 *
 * @param onBack - 返回上一层（mobile 栈式返回；desktop 可用于返回 index）
 */
import { useRef, useState } from "react";
import { ArrowLeft, Camera, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  cropAvatar,
  getUploadUrl,
  uploadToTicket,
  useAuthStore,
  useBreakpoint,
} from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";
import { Avatar } from "../primitives/Avatar";
import { Button } from "../primitives/Button";

/** 性别选项（0=保密 1=男 2=女） */
const GENDERS: { value: 0 | 1 | 2; labelKey: string }[] = [
  { value: 1, labelKey: "profile.genderMale" },
  { value: 2, labelKey: "profile.genderFemale" },
  { value: 0, labelKey: "profile.genderSecret" },
];

export function ProfileEditView({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const bp = useBreakpoint();
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);

  const [nickname, setNickname] = useState(user?.nickname ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [gender, setGender] = useState<0 | 1 | 2>(user?.gender ?? 0);
  const [busy, setBusy] = useState(false);
  /** 头像上传中：仅驱动头像转圈遮罩（与保存 busy 分离，互斥由下方 uploading 防重入保证） */
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** 局部 toast 文字，2s 后消失（不引全局 toast 系统） */
  const [toast, setToast] = useState<string | null>(null);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2000);
  };

  const onSave = () => {
    if (busy) return;
    setBusy(true);
    void updateProfile({ nickname: nickname.trim(), bio, gender })
      .then(() => flash(t("settings.saved")))
      .catch(() => flash(t("settings.saveFailed")))
      .finally(() => setBusy(false));
  };

  /** 打开系统图片选择器（Camera 角标触发） */
  const openAvatarPicker = () => {
    if (uploading) return;
    fileInputRef.current?.click();
  };

  /**
   * 选中头像文件：中心裁方 512 → 预签名直传 avatars → updateProfile 拿 publicUrl 即时刷新。
   * 任一步失败弹错误 toast；全程 uploading 防重入并显示转圈遮罩。
   */
  const handleAvatarPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 清空以便再次选同一文件
    if (!file || file.type.indexOf("image/") !== 0 || uploading) return;

    setUploading(true);
    void (async () => {
      try {
        const { blob } = await cropAvatar(file);
        const ticket = await getUploadUrl("avatar.jpg", "image/jpeg", blob.size, "avatars");
        await uploadToTicket(ticket, blob, "image/jpeg");
        if (!ticket.publicUrl) throw new Error("missing public url");
        await updateProfile({ avatarUrl: ticket.publicUrl });
        flash(t("settings.avatarUpdated"));
      } catch {
        flash(t("settings.avatarFailed"));
      } finally {
        setUploading(false);
      }
    })();
  };

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-1 py-2">
      {/* 移动端返回头 */}
      {bp === "mobile" && (
        <header className="-mx-1 -mt-2 flex h-12 items-center">
          <button
            className="md3-icon-btn text-on-surface-variant"
            onClick={onBack}
            aria-label={t("chat.back")}
          >
            <ArrowLeft size={20} />
          </button>
          <span className="text-title-sm text-on-surface font-semibold">
            {t("settings.profile")}
          </span>
        </header>
      )}

      {/* 头像 + Camera 角标（点击换头像） */}
      <div className="flex justify-center pt-2">
        <button
          type="button"
          onClick={openAvatarPicker}
          disabled={uploading}
          className="relative inline-flex disabled:cursor-not-allowed"
          aria-label={t("settings.avatarChange")}
        >
          <Avatar name={nickname || "?"} src={user?.avatarUrl} size="xl" />
          {/* 上传中：半透明遮罩 + 转圈，压住整个头像 */}
          {uploading && (
            <span
              className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white"
              aria-label={t("settings.avatarUploading")}
            >
              <Loader2 size={22} className="animate-spin" />
            </span>
          )}
          <span className="bg-primary text-primary-on absolute -right-1 -bottom-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white dark:border-neutral-900">
            <Camera size={14} />
          </span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleAvatarPick}
        />
      </div>

      {/* 昵称 */}
      <label className="flex flex-col gap-2">
        <span className="text-label-lg text-on-surface-variant font-medium">
          {t("profile.nickname")}
        </span>
        <input
          value={nickname}
          maxLength={50}
          onChange={(e) => setNickname(e.target.value)}
          className="input-base"
        />
      </label>

      {/* 个性签名 */}
      <label className="flex flex-col gap-2">
        <span className="text-label-lg text-on-surface-variant font-medium">
          {t("profile.bio")}
        </span>
        <textarea
          value={bio}
          maxLength={500}
          rows={3}
          placeholder={t("profile.bioPlaceholder")}
          onChange={(e) => setBio(e.target.value)}
          className="input-base resize-none"
        />
      </label>

      {/* 性别三选一 */}
      <div className="flex flex-col gap-2">
        <span className="text-label-lg text-on-surface-variant font-medium">
          {t("profile.gender")}
        </span>
        <div className="flex gap-2">
          {GENDERS.map(({ value, labelKey }) => {
            const active = gender === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setGender(value)}
                className={cn(
                  "text-label-lg flex-1 rounded-lg border py-2.5 font-medium transition-colors",
                  active
                    ? "border-primary bg-primary-container/60 text-primary-on-container"
                    : "border-outline-variant text-on-surface-variant hover:bg-surface-container-high",
                )}
              >
                {t(labelKey)}
              </button>
            );
          })}
        </div>
      </div>

      {/* 保存 */}
      <Button variant="primary" className="mt-2 w-full" disabled={busy} onClick={onSave}>
        {t("common.save")}
      </Button>

      {/* 局部 toast */}
      {toast && (
        <div className="animate-fade-in bg-surface-container-high text-on-surface text-body-sm shadow-elevation-2 fixed bottom-8 left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2">
          {toast}
        </div>
      )}
    </div>
  );
}
