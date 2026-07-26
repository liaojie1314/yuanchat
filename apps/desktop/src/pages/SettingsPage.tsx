/**
 * SettingsPage — 设置页面（Desktop 端）
 *
 * @description
 * 三端响应式编排收敛在 @yuanchat/ui 的 SettingsScreen 中。
 * 桌面端特有的「检查更新」通过 aboutExtra 槽注入（web/admin 无 tauri
 * 运行时，不引入 updater 依赖）。
 */
import { SettingsScreen } from "@yuanchat/ui";
import { UpdateChecker } from "../components/UpdateChecker";

export function SettingsPage() {
  return <SettingsScreen aboutExtra={<UpdateChecker />} />;
}
