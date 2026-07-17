/**
 * ProfileEditView — 个人资料编辑视图
 *
 * @description
 * 设置页「个人资料」内容区：头像（Camera 角标，上传暂未支持）、昵称、
 * 个性签名、性别三选一，底部保存按钮（busy 防重入，成功/失败局部 toast）。
 *
 * 三端共用：desktop/tablet 内联于右内容区，mobile 栈式推入（外层 SettingsScreen
 * 提供返回头）。保存走 authStore.updateProfile → PUT /users/me。
 *
 * @param onBack - 返回上一层（mobile 栈式返回；desktop 可用于返回 index）
 */
import { useState } from "react";
import { ArrowLeft, Camera } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuthStore, useBreakpoint } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";
import { Avatar } from "./Avatar";
import { Button } from "./Button";

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

      {/* 头像 + Camera 角标 */}
      <div className="flex justify-center pt-2">
        <button
          type="button"
          onClick={() => flash(t("settings.avatarLater"))}
          className="relative inline-flex"
          aria-label={t("settings.avatarLater")}
        >
          <Avatar name={nickname || "?"} src={user?.avatarUrl} size="xl" />
          <span className="bg-primary text-primary-on absolute -right-1 -bottom-1 grid h-7 w-7 place-items-center rounded-full border-2 border-white dark:border-neutral-900">
            <Camera size={14} />
          </span>
        </button>
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
