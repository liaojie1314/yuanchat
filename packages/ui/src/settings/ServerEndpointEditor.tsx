/**
 * 服务器地址编辑器与登录前入口
 *
 * @description
 * 地址切换必须在**登录之前**就能用：内置地址一旦连不上（换了服务器、只想连本地开发服、
 * 或正式服暂时不可达），用户根本登不进去，而设置页在登录之后 —— 那个入口在最需要它的
 * 时候恰好是不可达的。因此这里把编辑器抽成独立组件，登录页用 {@link ServerEndpointDialog}
 * 弹出，设置页用 {@link ServerEndpointEditor} 内嵌，两处共用同一份逻辑。
 *
 * 构建期默认地址仍由各 app 的 `.env.*`（`VITE_API_BASE_URL` / `VITE_WS_URL`）决定，
 * 本编辑器只负责在此之上做本机覆盖。
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  applyServerEndpoint,
  getDefaultServerEndpoint,
  getServerEndpoint,
  getServerEndpointOverride,
} from "@yuanchat/shared";
import { Button } from "../primitives/Button";
import { Input } from "../primitives/Input";

/** 本地开发默认地址，与 serverEndpoint.ts 的兜底值保持一致 */
const LOCAL_PRESET = { apiBaseUrl: "http://localhost:8085", wsUrl: "ws://localhost:8086" };

export interface ServerEndpointEditorProps {
  /** 保存/恢复生效前的回调，弹窗用它先关掉自己（随后页面会整体重载） */
  onApplied?: () => void;
}

/**
 * 地址编辑表单：预设填充 + 两个输入框 + 保存/恢复
 *
 * @param props - 见 {@link ServerEndpointEditorProps}
 */
export function ServerEndpointEditor({ onApplied }: ServerEndpointEditorProps = {}) {
  const { t } = useTranslation();
  const fallback = getDefaultServerEndpoint();
  const current = getServerEndpoint();
  const isOverridden = getServerEndpointOverride() !== null;

  const [apiBaseUrl, setApiBaseUrl] = useState(current.apiBaseUrl);
  const [wsUrl, setWsUrl] = useState(current.wsUrl);

  const trimmedApi = apiBaseUrl.trim();
  const trimmedWs = wsUrl.trim();
  const dirty = trimmedApi !== current.apiBaseUrl || trimmedWs !== current.wsUrl;

  /** 预设只填输入框、不直接生效：直接重载会让误触代价过大 */
  const fillPreset = (preset: { apiBaseUrl: string; wsUrl: string }) => {
    setApiBaseUrl(preset.apiBaseUrl);
    setWsUrl(preset.wsUrl);
  };

  const apply = (endpoint: { apiBaseUrl: string; wsUrl: string } | null) => {
    onApplied?.();
    applyServerEndpoint(endpoint);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => fillPreset(fallback)}>
          {t("settings.serverPresetDefault")}
        </Button>
        <Button variant="secondary" onClick={() => fillPreset(LOCAL_PRESET)}>
          {t("settings.serverPresetLocal")}
        </Button>
      </div>

      <label className="text-label-md text-on-surface-variant flex flex-col gap-1">
        {t("settings.serverApi")}
        <Input
          value={apiBaseUrl}
          onChange={(e) => setApiBaseUrl(e.target.value)}
          placeholder="https://api.example.com"
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          inputMode="url"
        />
      </label>

      <label className="text-label-md text-on-surface-variant flex flex-col gap-1">
        {t("settings.serverWs")}
        <Input
          value={wsUrl}
          onChange={(e) => setWsUrl(e.target.value)}
          placeholder="wss://ws.example.com"
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          inputMode="url"
        />
      </label>

      <p className="text-on-surface-variant text-xs">{t("settings.serverSwitchHint")}</p>

      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!dirty || trimmedApi === "" || trimmedWs === ""}
          onClick={() => apply({ apiBaseUrl: trimmedApi, wsUrl: trimmedWs })}
        >
          {t("settings.serverSave")}
        </Button>
        <Button variant="secondary" disabled={!isOverridden} onClick={() => apply(null)}>
          {t("settings.serverReset")}
        </Button>
      </div>
    </div>
  );
}

export interface ServerEndpointDialogProps {
  /** 是否打开 */
  open: boolean;
  /** 关闭弹窗 */
  onClose: () => void;
}

/**
 * 地址切换弹窗（登录页使用）
 *
 * @param props - 见 {@link ServerEndpointDialogProps}
 */
export function ServerEndpointDialog({ open, onClose }: ServerEndpointDialogProps) {
  const { t } = useTranslation();
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="bg-scrim/40 absolute inset-0" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.server")}
        className="bg-surface-container-high shadow-elevation-3 relative max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-lg p-5"
      >
        <h2 className="text-title-md text-on-surface mb-1 font-semibold">{t("settings.server")}</h2>
        <p className="text-on-surface-variant mb-4 text-xs">{t("settings.serverDesc")}</p>

        <ServerEndpointEditor onApplied={onClose} />

        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * 登录页上的「服务器」入口：一行小字按钮 + 当前地址，点开 {@link ServerEndpointDialog}。
 *
 * 显示当前 API 地址而不只是一个按钮文案 —— 连不上时用户第一眼要确认的就是「它在连哪」。
 */
export function ServerSwitchLink() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { apiBaseUrl } = getServerEndpoint();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-on-surface-variant hover:text-primary mx-auto block max-w-full truncate text-xs"
      >
        {t("settings.server")}: {apiBaseUrl}
      </button>
      <ServerEndpointDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
