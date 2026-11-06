import { QrLoginScreen } from "@yuanchat/ui";
import { useIsDesktop } from "@yuanchat/shared";
import { TitleBar } from "../components/TitleBar";
import { useIsMobile } from "../hooks/useIsMobile";

/**
 * 扫码登录页：注入桌面自绘顶栏，主窗口尺寸由 App 的登录态 effect 统一管理。
 *
 * 该路由在桌面端是登录窗口内的路由跳转（不像忘记密码那样另开窗口），
 * 所以「返回密码登录」由组件内的 `<Link to="/login" replace>` 承担，这里不注入返回行为。
 * 同一套代码也打 Android 包，非 Tauri 或移动端形态下顶栏与窗口调整都自动退化为无操作。
 */
export function QrLoginPage() {
  const isDesktop = useIsDesktop();
  const isMobile = useIsMobile();

  return (
    <QrLoginScreen
      topSlot={isDesktop && !isMobile ? <TitleBar showMaximize={false} /> : undefined}
    />
  );
}
