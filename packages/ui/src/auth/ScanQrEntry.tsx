/**
 * 扫码登录流程（扫码端，需已登录）
 *
 * @description
 * 由宿主 app 在稳定位置挂载，靠 `active` 触发：调原生条码扫描 → 校验二维码来源
 * → `scanQr` 登记扫描 → 弹确认框展示「将以哪个账号登录」→ `confirmQr` 完成确认。
 *
 * 刻意**不含**触发按钮：入口按钮在会话列表的 `+` 菜单里（`ConversationList` 的 `onScanQr`）。
 * 菜单点开后会随点击外部而关闭，若把本组件连按钮一起塞进菜单，确认框会随菜单一起卸载，
 * 用户就没机会点确认了。
 *
 * 三处要点：
 * 1. **必须校验 scheme**。原生扫描返回的是任意字符串，不校验就等于把任意二维码里的内容
 *    当会话凭据提交给后端。只接受 `yuanchat://login?t=<token>`。
 * 2. **确认前必须让用户看到账号**。令牌是在 `confirmQr` 这一步签发给被扫端的，
 *    确认动作等于把自己的登录态交给另一台设备，必须先展示是哪个账号再由用户显式确认。
 * 3. **放弃确认必须回报服务端**（`cancelQr`）。会话此时已是 `scanned`，被扫端正停在
 *    「请在手机上确认」那一屏；不回报的话它要一直等到会话过期才恢复，
 *    而且看到的是「二维码已过期」而不是「已在手机上取消」。
 *
 * 扫描能力只在移动端存在，组件因此接受注入式 `scan`：由宿主 app 传入
 * `@tauri-apps/plugin-barcode-scanner` 的实现。这样 packages/ui 不依赖 Tauri，单测也无需真机。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  scanQr,
  confirmQr,
  cancelQr,
  registerBackInterceptor,
  type QrScanIdentity,
} from "@yuanchat/shared";
import { ConfirmDialog } from "../primitives/ConfirmDialog";
import { mapAuthError } from "./mapAuthError";
import { parseLoginQr } from "./parseLoginQr";

/** 原生扫描器：返回扫到的原始字符串，用户取消时返回 null */
export type ScanFn = () => Promise<string | null>;

export interface ScanQrEntryProps {
  /** 由宿主 app 注入的原生扫描实现 */
  scan: ScanFn;
  /**
   * 由宿主 app 注入的取消扫描实现
   *
   * 相机取景期间前端界面是透明的，用户唯一的退出手段就是系统返回键；
   * 不注入的话按返回会穿透到路由层甚至退出应用，相机也留在开着的状态。
   */
  cancelScan?: () => void;
  /** 置为 true 时开始一次扫码；流程结束后宿主应重置为 false */
  active: boolean;
  /** 流程结束（成功、失败或用户取消）时回调，宿主据此把 `active` 复位 */
  onClose: () => void;
}

/**
 * 扫码登录流程
 *
 * @param props - 见 {@link ScanQrEntryProps}
 */
export function ScanQrEntry({ scan, cancelScan, active, onClose }: ScanQrEntryProps) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ token: string; who: QrScanIdentity } | null>(null);
  /** 防止同一次 active 因重渲染重复唤起相机 */
  const scanningRef = useRef(false);

  useEffect(() => {
    if (!active || scanningRef.current) return;
    scanningRef.current = true;
    let cancelled = false;

    void (async () => {
      try {
        const raw = await scan();
        if (cancelled) return;
        // 用户取消扫描：静默结束，不当作错误
        if (raw === null) {
          onClose();
          return;
        }

        const token = parseLoginQr(raw);
        if (token === null) {
          setError(t("auth.qrNotOurs"));
          onClose();
          return;
        }

        const who = await scanQr(token);
        if (cancelled) return;
        setPending({ token, who });
      } catch (e) {
        if (cancelled) return;
        setError(t(mapAuthError(e, "auth.qrFailed")));
        onClose();
      } finally {
        scanningRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [active, scan, onClose, t]);

  /**
   * 放弃这次授权：关掉确认框并把 `canceled` 回报给服务端
   *
   * 取消是尽力而为，失败不上屏报错：会话最多 120 秒后自行过期，
   * 而用户此刻的意图就是离开这条链路，弹一个他无法处置的错误只会碍事。
   */
  const dismiss = useCallback(
    (token: string) => {
      setPending(null);
      onClose();
      void cancelQr(token).catch(() => {});
    },
    [onClose],
  );

  // 安卓返回键：相机取景中按返回应当取消扫描并关掉相机，确认框开着时按返回等于放弃确认。
  // 两者都不拦的话返回会穿透到路由层，相机还留在开着的状态。
  //
  // 确认框那一支必须与点「取消」走同一条收尾：按返回同样是放弃授权，
  // 只把弹层关掉而不回报服务端，被扫端就会一直停在「请在手机上确认」直到会话过期。
  useEffect(() => {
    if (!active && pending === null) return;
    return registerBackInterceptor(() => {
      if (pending !== null) {
        dismiss(pending.token);
        return true;
      }
      cancelScan?.();
      onClose();
      return true;
    });
  }, [active, pending, cancelScan, onClose, dismiss]);

  async function handleConfirm() {
    const current = pending;
    if (!current) return;
    setPending(null);
    try {
      await confirmQr(current.token);
    } catch (e) {
      setError(t(mapAuthError(e, "auth.qrFailed")));
    } finally {
      onClose();
    }
  }

  return (
    <>
      {error !== null && (
        <div
          role="alert"
          className="bg-surface-container-high text-error shadow-elevation-2 fixed inset-x-4 bottom-6 z-30 rounded-lg px-4 py-3 text-sm"
        >
          <button type="button" className="w-full text-left" onClick={() => setError(null)}>
            {error}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={pending !== null}
        title={t("auth.qrConfirmTitle")}
        message={t("auth.qrConfirmMessage", { nickname: pending?.who.nickname ?? "" })}
        confirmLabel={t("auth.qrConfirmLogin")}
        onConfirm={handleConfirm}
        onCancel={() => pending !== null && dismiss(pending.token)}
      />
    </>
  );
}
