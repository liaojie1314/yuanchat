/**
 * SettingsPage — 设置页面（Desktop 端）
 *
 * @description
 * 三端响应式编排收敛在 @yuanchat/ui 的 SettingsScreen 中。
 * 桌面端特有的「检查更新」通过 aboutExtra 槽注入（web/admin 无 tauri
 * 运行时，不引入 updater 依赖；Android/iOS 无 updater 插件，同样不渲染）。
 */
import { useNavigate } from "react-router-dom";
import { SettingsScreen } from "@yuanchat/ui";
import { UpdateChecker } from "../components/UpdateChecker";
import { useIsMobile } from "../hooks/useIsMobile";

export function SettingsPage() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  return (
    <SettingsScreen
      aboutExtra={isMobile ? undefined : <UpdateChecker />}
      // 改密复用忘记密码那条三段式链路：同一组端点，登录态与否都能走
      onChangePassword={() => navigate("/forgot-password")}
    />
  );
}
