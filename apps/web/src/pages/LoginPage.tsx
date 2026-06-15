import { useState } from "react";
import { Button, Input } from "@yuanchat/ui";
import { useAuthStore } from "@yuanchat/shared";
import { MessageCircle } from "lucide-react";

export function LoginPage() {
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const loginWithPassword = useAuthStore((s) => s.loginWithPassword);

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
    <div className="flex items-center justify-center min-h-screen surface-gradient">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 rounded-full bg-tertiary/10 blur-3xl" />
      </div>

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
