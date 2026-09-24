/**
 * Admin 登录页 — 复用 authStore 登录，成功后探测 admin 权限。
 *
 * role 不在登录响应里（shared User 无该字段），用一次最小 admin API
 * 调用探测：403 → 非管理员，立即登出并提示。
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Input } from "@yuanchat/ui";
import { useAuthStore, ApiError } from "@yuanchat/shared";
import { listUsers } from "../api";

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [account, setAccount] = useState("");
  const [pwd, setPwd] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const loginWithPassword = useAuthStore((s) => s.loginWithPassword);
  const logout = useAuthStore((s) => s.logout);

  const handleLogin = async () => {
    setError("");
    if (!account.trim() || !pwd) return;
    setLoading(true);
    try {
      await loginWithPassword(account, pwd);
      // 探测 admin 权限：非 admin 会被后端 RequireAdmin 拒（403）
      try {
        await listUsers("", 1, 1);
      } catch (probeErr) {
        if (probeErr instanceof ApiError && probeErr.code === 403) {
          logout();
          setError(t("admin.login.notAdmin"));
          return;
        }
        throw probeErr;
      }
      navigate("/users", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("auth.loginFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="surface-gradient grid min-h-screen place-items-center">
      <div className="w-full max-w-sm rounded-lg border border-outline-variant bg-surface px-8 py-10 shadow-lg">
        <div className="mb-8 text-center">
          <div className="brand-gradient mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-lg text-xl font-bold text-white">
            元
          </div>
          <h1 className="text-title-lg font-semibold text-on-surface">{t("admin.login.title")}</h1>
        </div>
        <div className="space-y-2">
          <Input
            placeholder={t("auth.phoneOrEmail")}
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
          />
          <Input
            type="password"
            placeholder={t("auth.password")}
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            error={error}
          />
          <Button className="mt-2 w-full" onClick={handleLogin} disabled={loading}>
            {t("auth.login")}
          </Button>
        </div>
      </div>
    </div>
  );
}
