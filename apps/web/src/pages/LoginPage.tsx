import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Button, Input } from "@yuanchat/ui";
import { useAuthStore } from "@yuanchat/shared";
import { MessageCircle } from "lucide-react";

export function LoginPage() {
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
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

  const handleLogin = async () => {
    if (!account || !password) return;
    setError("");
    setLoading(true);
    try {
      await loginWithPassword(account, password);
    } catch (e) {
      setError(e instanceof Error ? e.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="surface-gradient relative flex min-h-screen items-center justify-center overflow-y-auto py-8">
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
            placeholder="手机号或邮箱"
            type="text"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
          />
          <Input
            placeholder="密码"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            error={error}
          />
          <Button className="w-full" onClick={handleLogin} disabled={loading}>
            {loading ? "登录中…" : "登 录"}
          </Button>
        </div>

        <p className="text-on-surface-variant mt-6 text-center text-label-md">
          还没有账号？{" "}
          <Link to="/register" className="cursor-pointer font-medium text-primary hover:underline">
            立即注册
          </Link>
        </p>
      </div>
    </div>
  );
}
