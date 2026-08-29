import { useNavigate } from "react-router-dom";
import { ForgotPasswordScreen } from "@yuanchat/ui";
import { useIsDesktop } from "@yuanchat/shared";
import { TitleBar } from "../components/TitleBar";
import { useIsMobile } from "../hooks/useIsMobile";

/**
 * 忘记密码页 —— 桌面端注入自绘窗口顶栏与窗口级返回
 *
 * 该路由在桌面端是独立的无边框 WebviewWindow（由登录页开出），
 * 所以「返回登录」是关闭本窗口并把焦点交回主窗口，而不是路由跳转；
 * 同一套代码也打 Android 包，非 Tauri 或移动端形态下退回普通路由跳转。
 */
export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const isMobile = useIsMobile();

  const goBack = async () => {
    if (isDesktop) {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        const main = await WebviewWindow.getByLabel("main");
        if (main) {
          await main.setFocus();
          await main.center();
        }
        await getCurrentWindow().close();
        return;
      } catch {
        /* 继续向下走 */
      }
    }
    navigate("/login", { replace: true });
  };

  return (
    <ForgotPasswordScreen
      topSlot={isDesktop && !isMobile ? <TitleBar showMaximize={false} /> : undefined}
      onDone={() => void goBack()}
    />
  );
}
