import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { RefreshCw, CheckCircle, Clock, Smartphone } from "lucide-react";

type QrStatus = "waiting" | "scanning" | "confirmed" | "expired";

function QrCodeCanvas({ size = 180, dimmed = false }: { size?: number; dimmed?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const M = 21;
    const c = size / M;

    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, size, size);

    const drawFinder = (startRow: number, startCol: number) => {
      ctx.fillStyle = "#000";
      ctx.fillRect(startCol * c, startRow * c, 7 * c, 7 * c);
      ctx.fillStyle = "#fff";
      ctx.fillRect((startCol + 1) * c, (startRow + 1) * c, 5 * c, 5 * c);
      ctx.fillStyle = "#000";
      ctx.fillRect((startCol + 2) * c, (startRow + 2) * c, 3 * c, 3 * c);
    };

    drawFinder(0, 0);
    drawFinder(0, 14);
    drawFinder(14, 0);

    for (let i = 8; i <= 12; i++) {
      if (i % 2 === 0) {
        ctx.fillStyle = "#000";
        ctx.fillRect(i * c, 6 * c, c, c);
        ctx.fillRect(6 * c, i * c, c, c);
      }
    }

    let s = 31337;
    const rand = () => {
      s = (s ^ (s << 13)) >>> 0;
      s = (s ^ (s >>> 17)) >>> 0;
      s = (s ^ (s << 5)) >>> 0;
      return s % 100;
    };

    ctx.fillStyle = "#000";
    for (let row = 0; row < M; row++) {
      for (let col = 0; col < M; col++) {
        if ((row < 9 && col < 9) || (row < 9 && col >= 13) || (row >= 13 && col < 9)) continue;
        if (row === 6 || col === 6) continue;
        if (rand() < 55) {
          ctx.fillRect(col * c, row * c, c, c);
        }
      }
    }
  }, [size]);

  return (
    <canvas
      ref={ref}
      width={size}
      height={size}
      style={{ opacity: dimmed ? 0.2 : 1, display: "block" }}
    />
  );
}

export function QrLoginPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<QrStatus>("waiting");
  const [qrKey, setQrKey] = useState(0);

  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const onMove = (e: MouseEvent) => setMousePos({ x: e.clientX, y: e.clientY });
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  useEffect(() => {
    if (status !== "waiting") return;
    const t = setTimeout(() => setStatus("expired"), 60000);
    return () => clearTimeout(t);
  }, [qrKey, status]);

  const refresh = () => {
    setStatus("waiting");
    setQrKey((k) => k + 1);
  };

  return (
    <div className="surface-gradient relative flex min-h-[var(--app-height,100vh)] flex-col overflow-y-auto">
      <div className="cursor-glow" style={{ left: mousePos.x, top: mousePos.y }} />

      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="aurora-orb -left-20 -top-20 h-[500px] w-[500px] bg-[#7EC8E3]" />
        <div className="aurora-orb -right-32 top-1/2 h-[400px] w-[400px] bg-[#A8CFFF]" />
        <div className="aurora-orb -bottom-20 left-1/3 h-[350px] w-[350px] bg-[#B8D8F0]" />
      </div>
      <div className="dot-grid" />
      <div className="light-sweep" />

      <div className="relative m-auto w-full max-w-md px-5 py-8">
        {/* 磨砂玻璃卡片 */}
        <div className="rounded-lg border border-white/60 bg-white/70 px-10 py-12 shadow-[0_8px_40px_rgba(0,0,0,0.08)] backdrop-blur-2xl">
          <div className="text-center">
            {/* 标题 */}
            <div className="mb-8">
              <div className="brand-gradient glow-brand mx-auto mb-4 inline-flex h-16 w-16 items-center justify-center rounded-lg text-white shadow-lg">
                <Smartphone size={28} />
              </div>
              <h1 className="text-2xl font-bold text-on-surface">{t("auth.qrLogin")}</h1>
              <p className="mt-1 text-sm text-on-surface-variant">{t("auth.qrSubtitle")}</p>
            </div>

            {/* 二维码区域 */}
            <div className="relative mx-auto mb-5 inline-block rounded-lg bg-white p-3 shadow-[0_4px_24px_rgba(0,0,0,0.10)]">
              <QrCodeCanvas key={qrKey} size={180} dimmed={status === "expired"} />

              {status === "expired" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center rounded-lg bg-black/40">
                  <Clock size={28} className="mb-2 text-white" />
                  <p className="text-sm font-medium text-white">{t("auth.qrExpired")}</p>
                </div>
              )}

              {status === "scanning" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center rounded-lg bg-primary/85">
                  <CheckCircle size={36} className="mb-2 text-white" />
                  <p className="text-sm font-medium text-white">{t("auth.qrScanned")}</p>
                  <p className="mt-0.5 text-xs text-white/80">{t("auth.qrConfirmOnPhone")}</p>
                </div>
              )}
            </div>

            {/* 状态提示 */}
            {status === "waiting" && (
              <p className="text-sm text-on-surface-variant">{t("auth.qrHint")}</p>
            )}
            {status === "expired" && (
              <button
                type="button"
                onClick={refresh}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:opacity-80"
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
                className="text-sm text-on-surface-variant hover:text-primary hover:opacity-80"
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
