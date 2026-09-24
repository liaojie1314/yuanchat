/**
 * Tauri 原生条码扫描适配
 *
 * @description
 * 把 `@tauri-apps/plugin-barcode-scanner` 收敛成 `@yuanchat/ui` 需要的 `ScanFn`：
 * 只扫二维码、返回扫到的原始字符串、用户取消或无权限时返回 null。
 *
 * 权限必须先申请再扫：插件的 `scan` 在未授权时直接失败，而 Android 的运行时权限
 * 只能由 `requestPermissions` 触发系统弹框（清单里声明 CAMERA 只是前提，不会自动弹）。
 * 用户永久拒绝时 `requestPermissions` 会立即返回 `denied`，此时唯一出路是去系统设置，
 * 因此引导到 `openAppSettings` 而不是反复弹框。
 */
import {
  scan as nativeScan,
  cancel as nativeCancel,
  checkPermissions,
  requestPermissions,
  openAppSettings,
  Format,
} from "@tauri-apps/plugin-barcode-scanner";

/**
 * 唤起原生相机扫一次二维码
 *
 * @returns 扫到的原始字符串；用户取消扫描或拒绝相机权限时返回 null
 * @remarks 返回值不做任何校验 —— 来源校验由 `parseLoginQr` 负责，
 *   这里只负责「把相机扫到的东西原样交出去」。
 */
export async function scanWithNativeCamera(): Promise<string | null> {
  let state = await checkPermissions();
  if (state !== "granted") {
    state = await requestPermissions();
  }
  if (state !== "granted") {
    // 永久拒绝后再调 requestPermissions 不会弹框，只能引导用户去系统设置
    if (state === "denied") {
      await openAppSettings();
    }
    return null;
  }

  try {
    const result = await nativeScan({ formats: [Format.QRCode], windowed: false });
    return result.content;
  } catch {
    // 插件在用户按返回键取消时以异常形式结束，等同于「没扫」
    return null;
  }
}

/**
 * 取消正在进行的扫描并关闭相机取景
 *
 * @remarks 供返回键处理调用。相机取景期间 WebView 是透明的，
 *   不调这个的话相机会一直开着、`scan()` 的 promise 也不会落地。
 *   刻意 fire-and-forget：调用方（返回键拦截器）必须同步返回，等不了 promise。
 */
export function cancelNativeScan(): void {
  void nativeCancel().catch(() => {
    // 没有进行中的扫描时插件会报错，对调用方无意义
  });
}
