import { useState, useEffect, useRef } from "react";
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
    <div className="relative flex items-center justify-center min-h-screen surface-gradient overflow-hidden">
      {/* 鼠标跟随光晕 */}
      <div
        ref={glowRef}
        className="cursor-glow"
        style={{ left: mousePos.x, top: mousePos.y }}
      />

      {/* 极光光斑 — 3 个彩色大光球漂浮动画 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="aurora-orb -top-20 -left-20 w-[500px] h-[500px] bg-[#7EC8E3]" />
        <div className="aurora-orb top-1/2 -right-32 w-[400px] h-[400px] bg-[#A8CFFF]" />
        <div className="aurora-orb -bottom-20 left-1/3 w-[350px] h-[350px] bg-[#B8D8F0]" />
      </div>

      {/* 微尘网格 */}
      <div className="dot-grid" />

      {/* 流光扫描 */}
      <div className="light-sweep" />

      <div className="relative w-full max-w-md p-8">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl brand-gradient text-white mb-5 glow-brand">
            <MessageCircle size={40} />
          </div>
          <h1 className="text-headline-lg font-semibold text-on-surface">元聊</h1>
          <p className="text-body-lg text-on-surface-variant mt-2">即时通讯</p>
        </div>

        <div className="glass-card p-6 space-y-4">
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

        <p className="text-center text-label-md text-on-surface-variant mt-6">
          还没有账号？{" "}
          <span className="text-primary cursor-pointer hover:underline font-medium">立即注册</span>
        </p>
      </div>
    </div>
  );
}
