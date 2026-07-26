/**
 * SettingsPage — 设置页面（Web 端）
 *
 * @description
 * 三端响应式编排收敛在 @yuanchat/ui 的 SettingsScreen 中。
 * Web 端特有的「浏览器通知」开关通过 aboutExtra 槽注入
 * （桌面端走原生通知，Tauri WebView 无 Push API）。
 */
import { SettingsScreen } from "@yuanchat/ui";
import { PushToggle } from "../components/PushToggle";

export function SettingsPage() {
  return <SettingsScreen aboutExtra={<PushToggle />} />;
}
