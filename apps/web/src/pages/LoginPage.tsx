import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Input } from "@yuanchat/ui";
import { useAuthStore } from "@yuanchat/shared";
import { validatePassword, validateYuanchatId } from "@yuanchat/shared/utils";
import { MessageCircle, QrCode } from "lucide-react";

export function LoginPage() {
  const navigate = useNavigate();
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
    } else {
      const idResult = validateYuanchatId(yuanchatId);
      if (!idResult.valid) {
        setYuanchatIdError(idResult.errors[0]);
        valid = false;
      }
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
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="surface-gradient relative flex min-h-[var(--app-height,100vh)] flex-col overflow-y-auto">
      <div ref={glowRef} className="cursor-glow" style={{ left: mousePos.x, top: mousePos.y }} />

      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="aurora-orb -left-20 -top-20 h-[500px] w-[500px] bg-[#7EC8E3]" />
        <div className="aurora-orb -right-32 top-1/2 h-[400px] w-[400px] bg-[#A8CFFF]" />
        <div className="aurora-orb -bottom-20 left-1/3 h-[350px] w-[350px] bg-[#B8D8F0]" />
      </div>
      <div className="dot-grid" />
      <div className="light-sweep" />

      <div className="relative m-auto w-full max-w-md px-5 py-8">
        {/* 磨砂玻璃卡片 */}
        <div className="rounded-3xl border border-white/60 bg-white/70 px-10 py-12 shadow-[0_8px_40px_rgba(0,0,0,0.08)] backdrop-blur-2xl">
          {/* Logo */}
          <div className="mb-8 text-center">
            <div className="brand-gradient glow-brand mb-4 inline-flex h-16 w-16 items-center justify-center rounded-2xl text-white shadow-lg">
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

          {/* 辅助链接行 */}
          <div className="mt-4 flex items-center justify-between text-sm">
            <Link to="/forgot-password" className="text-on-surface-variant hover:text-primary">
              忘记密码
            </Link>
            <button
              type="button"
              onClick={() => navigate("/qr-login")}
              className="text-on-surface-variant inline-flex items-center gap-1.5 hover:text-primary"
            >
              <QrCode size={14} />
              扫码登录
            </button>
          </div>

          <p className="text-on-surface-variant mt-4 text-center text-sm">
            还没有账号？{" "}
            <Link to="/register" replace className="cursor-pointer font-medium text-primary">
              立即注册
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
