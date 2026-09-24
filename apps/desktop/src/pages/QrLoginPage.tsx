import { QrLoginScreen } from "@yuanchat/ui";
import { useIsDesktop } from "@yuanchat/shared";
import { TitleBar } from "../components/TitleBar";
import { useIsMobile } from "../hooks/useIsMobile";

/**
 * 扫码登录页 —— 桌面端注入自绘窗口顶栏，并在登录成功后把窗口放大到主界面尺寸
 *
 * 该路由在桌面端是登录窗口内的路由跳转（不像忘记密码那样另开窗口），
 * 所以「返回密码登录」由组件内的 `<Link to="/login" replace>` 承担，这里不注入返回行为。
 * 同一套代码也打 Android 包，非 Tauri 或移动端形态下顶栏与窗口调整都自动退化为无操作。
 */
export function QrLoginPage() {
  const isDesktop = useIsDesktop();
  const isMobile = useIsMobile();

  const resizeToHomepage = async () => {
    try {
      const { getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      await win.setSize(new LogicalSize(1200, 800));
      await win.setResizable(true);
      await win.setMinSize(new LogicalSize(900, 600));
      await win.center();
    } catch {
      // 非 Tauri 环境忽略
    }
  };

  return (
    <QrLoginScreen
      topSlot={isDesktop && !isMobile ? <TitleBar showMaximize={false} /> : undefined}
      onLoggedIn={() => {
        if (isDesktop) void resizeToHomepage();
      }}
    />
  );
}
