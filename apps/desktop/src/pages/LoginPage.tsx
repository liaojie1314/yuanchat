import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Input } from "@yuanchat/ui";
import { useAuthStore, useIsDesktop } from "@yuanchat/shared";
import { validatePassword } from "@yuanchat/shared/utils";
import { useOpenAuthWindow } from "../hooks/useTauriAuth";
import { useIsMobile } from "../hooks/useIsMobile";
import { TitleBar } from "../components/TitleBar";
import { MessageCircle, QrCode } from "lucide-react";

export function LoginPage() {
  const isDesktop = useIsDesktop();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const openAuthWindow = useOpenAuthWindow();
  const [yuanchatId, setYuanchatId] = useState("");
  const [password, setPassword] = useState("");
  const [yuanchatIdError, setYuanchatIdError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [loading, setLoading] = useState(false);
  const loginWithPassword = useAuthStore((s) => s.loginWithPassword);

  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const glowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => setMousePos({ x: e.clientX, y: e.clientY });
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  const resizeToHomepage = async () => {
    try {
      const { getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      await win.setSize(new LogicalSize(1200, 800));
      await win.setResizable(true);
      await win.setMinSize(new LogicalSize(900, 600));
      await win.center();
    } catch {
      // 非 Tauri 环境忽略
    }
  };

  // 关闭登录窗口时同时关闭所有子窗口（注册、忘记密码等）
  const handleCloseAll = async () => {
    try {
      const { getAllWindows } = await import("@tauri-apps/api/window");
      const windows = await getAllWindows();
      await Promise.all(windows.map((w) => w.close()));
    } catch {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().close();
      } catch {
        /* 非 Tauri 环境 */
      }
    }
  };

  const clearErrors = () => {
    setYuanchatIdError("");
    setPasswordError("");
  };

  const handleLogin = async () => {
    clearErrors();
    let valid = true;

    if (!yuanchatId.trim()) {
      setYuanchatIdError("请输入元聊号");
      valid = false;
    }
    const pwResult = validatePassword(password);
    if (!pwResult.valid) {
      setPasswordError(pwResult.errors[0]);
      valid = false;
    }
    if (!valid) return;

    setLoading(true);
    try {
      await loginWithPassword(yuanchatId, password);
      if (isDesktop) await resizeToHomepage();
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="surface-gradient app-screen relative flex flex-col overflow-hidden">
      <div ref={glowRef} className="cursor-glow" style={{ left: mousePos.x, top: mousePos.y }} />
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="aurora-orb -left-20 -top-20 h-[500px] w-[500px] bg-[#7EC8E3]" />
        <div className="aurora-orb -right-32 top-1/2 h-[400px] w-[400px] bg-[#A8CFFF]" />
        <div className="aurora-orb -bottom-20 left-1/3 h-[350px] w-[350px] bg-[#B8D8F0]" />
      </div>
      <div className="dot-grid" />
      <div className="light-sweep" />

      {isDesktop && !isMobile && <TitleBar showMaximize={false} onClose={handleCloseAll} />}

      <div className="relative flex flex-1 flex-col overflow-y-auto">
        <div className="relative m-auto w-full max-w-md p-8">
          <div className="mb-8 text-center">
            <div className="brand-gradient glow-brand mb-4 inline-flex h-16 w-16 items-center justify-center rounded-2xl text-white">
              <MessageCircle size={30} />
            </div>
            <h1 className="text-2xl font-bold text-on-surface">元聊</h1>
            <p className="text-on-surface-variant mt-1 text-sm">即时通讯</p>
          </div>

          <div className="space-y-1">
            <Input
              placeholder="元聊号"
              type="text"
              value={yuanchatId}
              onChange={(e) => {
                setYuanchatId(e.target.value);
                if (yuanchatIdError) setYuanchatIdError("");
              }}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              error={yuanchatIdError}
            />
            <Input
              placeholder="密码"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (passwordError) setPasswordError("");
              }}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              error={passwordError}
            />
            <Button className="mt-1 w-full" onClick={handleLogin} disabled={loading}>
              {loading ? "登录中…" : "登 录"}
            </Button>
          </div>

          {/* 辅助链接行 — 手机端只有忘记密码靠右，桌面端左右各一 */}
          <div className="mt-4 flex items-center text-sm">
            <button
              type="button"
              onClick={() => openAuthWindow("/forgot-password", "忘记密码", 540, 640)}
              className={`text-on-surface-variant hover:text-primary${isMobile ? "ml-auto" : ""}`}
            >
              忘记密码
            </button>
            {!isMobile && (
              <button
                type="button"
                onClick={() => navigate("/qr-login")}
                className="text-on-surface-variant ml-auto inline-flex items-center gap-1.5 hover:text-primary"
              >
                <QrCode size={14} />
                扫码登录
              </button>
            )}
          </div>

          <p className="text-on-surface-variant mt-4 text-center text-sm">
            还没有账号？{" "}
            <button
              type="button"
              onClick={() => openAuthWindow("/register", "注册元聊", 540, 750)}
              className="cursor-pointer font-medium text-primary"
            >
              立即注册
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
