import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Button, Input } from "@yuanchat/ui";
import { useAuthStore, useIsDesktop } from "@yuanchat/shared";
import { validatePassword } from "@yuanchat/shared/utils";
import { useOpenAuthWindow } from "../hooks/useTauriAuth";
import { useIsMobile } from "../hooks/useIsMobile";
import { TitleBar } from "../components/TitleBar";
import { MessageCircle } from "lucide-react";

export function LoginPage() {
  const isDesktop = useIsDesktop();
  const isMobile = useIsMobile();
  const openAuthWindow = useOpenAuthWindow();
  const [yuanchatId, setYuanchatId] = useState("");
  const [password, setPassword] = useState("");
  const [yuanchatIdError, setYuanchatIdError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [loading, setLoading] = useState(false);
  const loginWithPassword = useAuthStore((s) => s.loginWithPassword);

  // 鼠标跟随光晕
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const glowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => setMousePos({ x: e.clientX, y: e.clientY });
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  /**
   * 登录成功后切换窗口为首页尺寸
   *
   * 登录页窗口 540×600（紧凑表单），
   * 首页需要更大的空间展示三栏布局（侧边栏 | 聊天窗 | 详情）。
   * Tauri 环境下调用原生 API 调整窗口大小；
   * 非 Tauri（浏览器开发）下仅跳转路由，App 自动切换页面。
   */
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

  /** 清除所有校验错误 */
  const clearErrors = () => {
    setYuanchatIdError("");
    setPasswordError("");
  };

  const handleLogin = async () => {
    clearErrors();
    let valid = true;

    // 逐字段校验
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
      // 桌面端登录成功 → 窗口切换为首页尺寸
      if (isDesktop) await resizeToHomepage();
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="surface-gradient relative flex h-screen flex-col overflow-hidden">
      {/* 背景装饰 */}
      <div ref={glowRef} className="cursor-glow" style={{ left: mousePos.x, top: mousePos.y }} />
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="aurora-orb -left-20 -top-20 h-[500px] w-[500px] bg-[#7EC8E3]" />
        <div className="aurora-orb -right-32 top-1/2 h-[400px] w-[400px] bg-[#A8CFFF]" />
        <div className="aurora-orb -bottom-20 left-1/3 h-[350px] w-[350px] bg-[#B8D8F0]" />
      </div>
      <div className="dot-grid" />
      <div className="light-sweep" />

      {/* 自定义操作栏 — 仅桌面端显示 */}
      {isDesktop && !isMobile && <TitleBar />}

      {/* 表单区域 */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        <div className="relative w-full max-w-md p-8">
          <div className="mb-10 text-center">
            <div className="brand-gradient glow-brand mb-5 inline-flex h-20 w-20 items-center justify-center rounded-2xl text-white">
              <MessageCircle size={40} />
            </div>
            <h1 className="text-headline-lg font-semibold text-on-surface">元聊</h1>
            <p className="text-on-surface-variant mt-2 text-body-lg">即时通讯</p>
          </div>

          <div className="glass-card space-y-4 p-6">
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
            <Button className="w-full" onClick={handleLogin} disabled={loading}>
              {loading ? "登录中…" : "登 录"}
            </Button>
          </div>

          <p className="text-on-surface-variant mt-6 text-center text-label-md">
            还没有账号？{" "}
            {isDesktop ? (
              <button
                type="button"
                onClick={() => openAuthWindow("/register", "注册元聊")}
                className="cursor-pointer font-medium text-primary hover:underline"
              >
                立即注册
              </button>
            ) : (
              <Link
                to="/register"
                replace
                className="cursor-pointer font-medium text-primary hover:underline"
              >
                立即注册
              </Link>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
