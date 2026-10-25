/**
 * SettingsPage — 设置页面（Desktop 端）
 *
 * @description
 * 三端响应式编排收敛在 @yuanchat/ui 的 SettingsScreen 中。
 * 「关于」分区的更新区块按平台注入：
 * - 桌面（win/mac/linux）：UpdateChecker，走 tauri-plugin-updater
 * - 移动（Android Tauri）：AndroidUpdateCard，走自建 OTA 链路
 *   （updater 插件不支持 Android，见 src/android/otaUpdater.ts）
 * web/admin 无 tauri 运行时，两者都不渲染。
 */
import { AndroidUpdateCard, SettingsScreen } from "@yuanchat/ui";
import { APP_VERSION } from "@yuanchat/ui";
import { UpdateChecker } from "../components/UpdateChecker";
import { checkAndroidUpdate, downloadAndInstall } from "../android/otaUpdater";
import { useIsMobile } from "../hooks/useIsMobile";

export function SettingsPage() {
  const isMobile = useIsMobile();
  return (
    <SettingsScreen
      aboutExtra={
        isMobile ? (
          <AndroidUpdateCard
            currentVersion={APP_VERSION}
            check={checkAndroidUpdate}
            install={downloadAndInstall}
          />
        ) : (
          <UpdateChecker />
        )
      }
    />
  );
}
