/**
 * QrLoginScreen — 扫码登录屏（被扫端）
 *
 * @description
 * 建会话 → 渲染二维码 → 每 2 秒轮询 → `confirmed` 时把换出的令牌写进登录态。
 * web 与桌面共用这一份实现，两端页面只做端差异注入。
 *
 * 四条与后端契约绑死的行为：
 * 1. **二维码内容原样取服务端的 `qr_payload`**，前端不拼 scheme —— 拼错扫码端就认不出来。
 * 2. **轮询必须带 `X-Qr-Poll-Secret`**。密钥只在建会话的响应里出现，不在二维码里；
 *    没有它，任何拍到二维码的人都能在用户点确认的那一刻抢先取走令牌。
 * 3. **倒计时取会话的 `expires_in`**（秒），每次轮询用服务端返回值校准，不写死时长。
 *    注意响应里有两个 `expires_in`：`data.expires_in` 是**会话**剩余秒数（倒计时用它），
 *    `data.tokens.expires_in` 是 **access 令牌**寿命（登录态用它），两者不可互换。
 * 4. **拿到令牌、会话过期或出错后立即停止轮询**。令牌只能取一次，会话已被销毁；
 *    继续轮询只会得到 404，还会在用户切页后留下一个持续打接口的定时器。
 */
import { useState, useEffect, useCallback, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import { RefreshCw, CheckCircle, Clock, Smartphone } from "lucide-react";
import { createQrSession, pollQrSession, useAuthStore, type QrSession } from "@yuanchat/shared";
import { mapAuthError } from "./mapAuthError";

/** 轮询间隔（毫秒）。后端 `LimitByIP(30, 60)` 就是按这个额度给的，不要更密 */
const POLL_INTERVAL_MS = 2000;
/** 二维码边长（像素），与两端原实现一致 */
const QR_SIZE = 180;

/**
 * 屏的阶段
 *
 * `loading` 建会话中；`pending` 等待扫码；`scanned` 已扫待确认；
 * `confirmed` 已换出令牌；`stopped` 已停止（过期或出错，可刷新重来）。
 */
type Phase = "loading" | "pending" | "scanned" | "confirmed" | "stopped";

export interface QrLoginScreenProps {
  /** 窗口顶栏插槽（桌面端注入自绘标题栏；web 端不传） */
  topSlot?: ReactNode;
  /** 登录成功后的端侧收尾动作（桌面端把窗口放大到主界面尺寸）；路由跳转由登录态守卫负责 */
  onLoggedIn?: () => void;
}

/**
 * 扫码登录屏（被扫端）
 *
 * @param props - 见 {@link QrLoginScreenProps}
 *
 * @example
 * // web：登录态翻转后由路由守卫自动进主界面
 * <QrLoginScreen />
 * // 桌面：注入自绘标题栏，并在登录成功后调整窗口尺寸
 * <QrLoginScreen topSlot={<TitleBar showMaximize={false} />} onLoggedIn={resizeToHomepage} />
 */
export function QrLoginScreen({ topSlot, onLoggedIn }: QrLoginScreenProps) {
  const { t } = useTranslation();
  const [session, setSession] = useState<QrSession | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  /** 会话剩余秒数，初值取服务端 `expires_in`，每次轮询再校准 */
  const [secondsLeft, setSecondsLeft] = useState(0);
  /** 停止原因的落地文案；空串表示按「二维码已过期」展示 */
  const [stopReason, setStopReason] = useState("");

  const start = useCallback(async () => {
    setStopReason("");
    setSession(null);
    setSecondsLeft(0);
    setPhase("loading");
    try {
      const created = await createQrSession();
      setSession(created);
      setSecondsLeft(created.expiresIn);
      setPhase("pending");
    } catch (e) {
      setStopReason(t(mapAuthError(e, "auth.qrFailed")));
      setPhase("stopped");
    }
  }, [t]);

  useEffect(() => {
    void start();
  }, [start]);

  // 会话倒计时：归零即停止轮询并进入可刷新态，不再等服务端的 404
  useEffect(() => {
    if (phase !== "pending" && phase !== "scanned") return;
    if (secondsLeft <= 0) {
      setStopReason("");
      setPhase("stopped");
      return;
    }
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [phase, secondsLeft]);

  // 轮询：仅在等待扫码与已扫待确认两个阶段进行
  //
  // 阶段一变（拿到令牌 / 过期 / 出错）本 effect 就被清理，interval 随之停掉，
  // cancelled 则挡住清理之后才回来的那些在途响应 —— 轮询是 setInterval，
  // 上一次没回来下一次照样出发，两次同时在飞是常态。
  useEffect(() => {
    if (!session) return;
    if (phase !== "pending" && phase !== "scanned") return;

    let cancelled = false;

    const timer = setInterval(() => {
      void (async () => {
        try {
          const res = await pollQrSession(session.qrToken, session.pollSecret);
          if (cancelled) return;
          if (res.status === "confirmed" && res.tokens) {
            // 会话已被服务端销毁：阶段切走即停轮询，之后到来的响应一律被 cancelled 挡掉
            setPhase("confirmed");
            await useAuthStore.getState().sessionFromTokens(res.tokens);
            onLoggedIn?.();
            return;
          }
          setSecondsLeft(res.expiresIn);
          setPhase(res.status === "scanned" ? "scanned" : "pending");
        } catch (e) {
          if (cancelled) return;
          // 任何错误都停：404 是会话已终结，403 是密钥不对，429 再打只会更糟。
          // 用户可以点刷新重来，比无声地继续打接口好。
          const key = mapAuthError(e, "auth.qrFailed");
          setStopReason(key === "auth.qrExpired" ? "" : t(key));
          setPhase("stopped");
        }
      })();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [session, phase, onLoggedIn, t]);

  const stopped = phase === "stopped";

  return (
    <div className="surface-gradient app-screen relative flex flex-col overflow-hidden">
      {/* 背景装饰 */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="aurora-orb -top-20 -left-20 h-[500px] w-[500px] bg-[#7EC8E3]" />
        <div className="aurora-orb top-1/2 -right-32 h-[400px] w-[400px] bg-[#A8CFFF]" />
        <div className="aurora-orb -bottom-20 left-1/3 h-[350px] w-[350px] bg-[#B8D8F0]" />
      </div>
      <div className="dot-grid pointer-events-none absolute inset-0" />

      {topSlot}

      <div className="relative flex flex-1 flex-col overflow-y-auto">
        <div className="relative m-auto w-full max-w-md px-5 py-8">
          {/* 磨砂玻璃卡片 */}
          <div className="rounded-lg border border-white/60 bg-white/70 px-10 py-12 text-center shadow-[0_8px_40px_rgba(0,0,0,0.08)] backdrop-blur-2xl">
            {/* 标题 */}
            <div className="mb-8">
              <div className="brand-gradient glow-brand mx-auto mb-4 inline-flex h-16 w-16 items-center justify-center rounded-lg text-white shadow-lg">
                <Smartphone size={28} />
              </div>
              <h1 className="text-on-surface text-2xl font-bold">{t("auth.qrLogin")}</h1>
              <p className="text-on-surface-variant mt-1 text-sm">{t("auth.qrSubtitle")}</p>
            </div>

            {/* 二维码区域 */}
            <div className="relative mx-auto mb-5 inline-block rounded-lg bg-white p-3 shadow-[0_4px_24px_rgba(0,0,0,0.10)]">
              <div
                data-testid="qr-code"
                data-qr-value={session ? session.qrPayload : ""}
                // 用类名而不是内联 style 表达暗化：内联的 `opacity: dimmed ? 0.2 : 1`
                // 压缩后是 `m?.2:1`，虽然按标准会被解析成三元（`?.` 后跟数字不是可选链），
                // 但会让「产物里不许出现 ?.」的兼容性审计 grep 报假命中。
                // flex 顺带消掉 svg 作为行内元素带来的基线空隙
                className={["flex", stopped ? "opacity-20" : "opacity-100"].join(" ")}
              >
                {/* 内容必须是服务端下发的 qr_payload 原文 */}
                <QRCodeSVG value={session ? session.qrPayload : ""} size={QR_SIZE} />
              </div>

              {stopped && (
                <div className="absolute inset-0 flex flex-col items-center justify-center rounded-lg bg-black/40 px-2">
                  <Clock size={28} className="mb-2 text-white" />
                  <p className="text-sm font-medium text-white">
                    {stopReason || t("auth.qrExpired")}
                  </p>
                </div>
              )}

              {phase === "scanned" && (
                <div className="bg-primary/85 absolute inset-0 flex flex-col items-center justify-center rounded-lg">
                  <CheckCircle size={36} className="mb-2 text-white" />
                  <p className="text-sm font-medium text-white">{t("auth.qrScanned")}</p>
                  <p className="mt-0.5 text-xs text-white/80">{t("auth.qrConfirmOnPhone")}</p>
                </div>
              )}
            </div>

            {/* 状态提示 */}
            {(phase === "loading" || phase === "pending" || phase === "confirmed") && (
              <p className="text-on-surface-variant text-sm">{t("auth.qrHint")}</p>
            )}
            {stopped && (
              <button
                type="button"
                onClick={() => void start()}
                className="text-primary inline-flex items-center gap-1.5 text-sm font-medium hover:opacity-80"
              >
                <RefreshCw size={14} />
                {t("auth.qrRefresh")}
              </button>
            )}

            {/* 返回密码登录 */}
            <div className="mt-8">
              <Link
                to="/login"
                replace
                className="text-on-surface-variant hover:text-primary text-sm hover:opacity-80"
              >
                {t("auth.backToPasswordLogin")}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
