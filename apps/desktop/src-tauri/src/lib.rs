/// Linux（WebKitGTK）上放开麦克风采集。
///
/// WebKitGTK 默认关闭 media-stream：`navigator.mediaDevices` 整个对象都不存在，
/// 前端调 getUserMedia 直接抛错，语音消息只能显示「没有麦克风权限」。
/// 而且它不像浏览器自带授权气泡 —— 不接 permission-request 信号的话请求默认被拒，
/// 用户永远等不到申请框。桌面端录音的唯一入口是用户主动点麦克风按钮，
/// 那一次点击即是授权，所以这里只放行「音频采集」，摄像头等其它请求交回默认处理。
///
/// @param window - 主窗口（需要拿到底层 WebKitWebView）
#[cfg(target_os = "linux")]
fn allow_microphone(window: &tauri::WebviewWindow) {
    use webkit2gtk::glib::prelude::*;
    use webkit2gtk::{
        PermissionRequestExt, SettingsExt, UserMediaPermissionRequest,
        UserMediaPermissionRequestExt, WebViewExt,
    };

    if let Err(e) = window.with_webview(|webview| {
        let view = webview.inner();
        if let Some(settings) = WebViewExt::settings(&view) {
            settings.set_enable_media_stream(true);
        }
        view.connect_permission_request(|_, request| {
            match request.downcast_ref::<UserMediaPermissionRequest>() {
                Some(media) if media.is_for_audio_device() => {
                    media.allow();
                    true
                }
                _ => false,
            }
        });
    }) {
        log::warn!("麦克风权限放行失败，语音消息将不可用: {e}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_log::Builder::default().build());

    // 自动更新仅桌面端可用（移动端由应用商店分发）
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    // 原生条码扫描只有移动端有实现（桌面端 Cargo.toml 里就没引这个依赖）
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let builder = builder.plugin(tauri_plugin_barcode_scanner::init());

    builder
        .setup(|app| {
            // Windows（WebView2）与 macOS（WKWebView）由 wry 自行处理授权请求，
            // 只有 WebKitGTK 需要在这里补一手
            #[cfg(target_os = "linux")]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    allow_microphone(&window);
                }
            }
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running YuanChat");
}
