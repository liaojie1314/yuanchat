import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Button, Input } from "@yuanchat/ui";
import { useAuthStore } from "@yuanchat/shared";
import { validatePassword } from "@yuanchat/shared/utils";
import { MessageCircle } from "lucide-react";

export function LoginPage() {
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
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="surface-gradient relative flex min-h-[var(--app-height,100vh)] flex-col overflow-y-auto py-8">
      {/* 鼠标跟随光晕 */}
      <div ref={glowRef} className="cursor-glow" style={{ left: mousePos.x, top: mousePos.y }} />

      {/* 极光光斑 — 3 个彩色大光球漂浮动画 */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="aurora-orb -left-20 -top-20 h-[500px] w-[500px] bg-[#7EC8E3]" />
        <div className="aurora-orb -right-32 top-1/2 h-[400px] w-[400px] bg-[#A8CFFF]" />
        <div className="aurora-orb -bottom-20 left-1/3 h-[350px] w-[350px] bg-[#B8D8F0]" />
      </div>

      {/* 微尘网格 */}
      <div className="dot-grid" />

      {/* 流光扫描 */}
      <div className="light-sweep" />

      <div className="relative m-auto w-full max-w-md p-8">
        <div className="mb-10 text-center">
          <div className="brand-gradient glow-brand mb-5 inline-flex h-20 w-20 items-center justify-center rounded-2xl text-white">
            <MessageCircle size={40} />
          </div>
          <h1 className="text-headline-lg font-semibold text-on-surface">元聊</h1>
          <p className="text-on-surface-variant mt-2 text-body-lg">即时通讯</p>
        </div>

        <div className="space-y-4">
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
          <Link
            to="/register"
            replace
            className="cursor-pointer font-medium text-primary hover:underline"
          >
            立即注册
          </Link>
        </p>
      </div>
    </div>
  );
}
