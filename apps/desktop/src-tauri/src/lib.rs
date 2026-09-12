#[cfg(target_os = "linux")]
mod native_rtc;

/// Linux（WebKitGTK）上放开麦克风与摄像头采集，并启用 WebRTC。
///
/// WebKitGTK 默认关闭 media-stream：`navigator.mediaDevices` 整个对象都不存在，
/// 前端调 getUserMedia 直接抛错，语音消息只能显示「没有麦克风权限」。
/// 它还从 2.38 起把 WebRTC 单独收在 `enable-webrtc` 开关后面、同样默认关闭 ——
/// 只开 media-stream 的话 getUserMedia 能过，`RTCPeerConnection` 却是 undefined。
/// 而且它不像浏览器自带授权气泡 —— 不接 permission-request 信号的话请求默认被拒，
/// 用户永远等不到申请框。采集的唯一入口是用户主动点「语音消息」或「通话」按钮，
/// 那一次点击即是授权，因此这里对音频与视频请求都直接放行，其余交回默认处理。
///
/// 宿主还需装 `gstreamer1.0-nice`：WebKitGTK 的 WebRTC 走 GstWebRTC，
/// ICE 代理由该插件提供，缺它 `RTCPeerConnection` 收集不到任何候选。
///
/// 注意这两个开关只是**必要条件**：WebKitGTK 是否编进了 GstWebRTC 后端由发行版的
/// 构建选项决定，编掉的话 `enable-webrtc` 读回来仍是 true 而 `RTCPeerConnection`
/// 整个类不存在。Ubuntu 2.50.4 与 GNOME 官方 Flatpak runtime 实测都是这样
/// （见设计文档 §3.11），两处独立打包都关着，说明是上游默认而非发行版取舍。
/// 通话因此不依赖 WebView 的 WebRTC：媒体面走进程内的 GStreamer
/// （见 [`native_rtc`]），`enable-webrtc` 仍然打开是为了将来 WebKitGTK 补上后
/// 能直接走回标准实现。
///
/// @param window - 主窗口（需要拿到底层 WebKitWebView）
#[cfg(target_os = "linux")]
fn allow_media(window: &tauri::WebviewWindow) {
    use webkit2gtk::glib::prelude::*;
    use webkit2gtk::{
        PermissionRequestExt, SettingsExt, UserMediaPermissionRequest,
        UserMediaPermissionRequestExt, WebViewExt,
    };

    if let Err(e) = window.with_webview(|webview| {
        let view = webview.inner();
        if let Some(settings) = WebViewExt::settings(&view) {
            settings.set_enable_media_stream(true);
            settings.set_enable_webrtc(true);
            // WebKitGTK 没有可外接的开发者工具，前端的 console 是排查通话这类
            // 「两端同时在线才能复现」问题的唯一窗口。仅 debug 构建开启，
            // 发布版不把用户的控制台输出泄到 stdout
            #[cfg(debug_assertions)]
            settings.set_enable_write_console_messages_to_stdout(true);
        }
        view.connect_permission_request(|_, request| {
            match request.downcast_ref::<UserMediaPermissionRequest>() {
                Some(media) if media.is_for_audio_device() || media.is_for_video_device() => {
                    media.allow();
                    true
                }
                _ => false,
            }
        });
    }) {
        log::warn!("媒体权限放行失败，语音消息与通话将不可用: {e}");
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

    // Linux 的通话媒体面走进程内 GStreamer（WebKitGTK 没有 RTCPeerConnection），
    // 其余平台的 WebView 自带 WebRTC，不注册这组命令
    #[cfg(target_os = "linux")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        native_rtc::native_rtc_available,
        native_rtc::native_rtc_video_available,
        native_rtc::native_rtc_video_url,
        native_rtc::native_rtc_create,
        native_rtc::native_rtc_create_offer,
        native_rtc::native_rtc_create_answer,
        native_rtc::native_rtc_set_remote,
        native_rtc::native_rtc_add_candidate,
        native_rtc::native_rtc_set_muted,
        native_rtc::native_rtc_set_camera,
        native_rtc::native_rtc_close,
        native_rtc::native_rtc_close_all,
    ]);

    builder
        .setup(|app| {
            // Windows（WebView2）与 macOS（WKWebView）由 wry 自行处理授权请求，
            // 只有 WebKitGTK 需要在这里补一手
            #[cfg(target_os = "linux")]
            {
                use tauri::{Listener, Manager};
                // 必须覆盖**每一个**窗口，不能只给 main：通话在独立窗口里完成，
                // 而设置与授权回调都是按 WebView 实例挂的。只给 main 的话通话窗口
                // 取不到麦克风，`probeLocalMedia` 失败即自我关闭 —— 表现为点了通话
                // 按钮后窗口一闪而过，且没有任何报错
                for window in app.webview_windows().values() {
                    allow_media(window);
                }
                // 通话窗口是运行时才建的，`setup` 阶段还不存在，故再监听一次创建事件
                let handle = app.handle().clone();
                app.listen_any("tauri://window-created", move |_| {
                    for window in handle.webview_windows().values() {
                        allow_media(window);
                    }
                });
            }
            let _ = app;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running YuanChat")
        .run(|_app, event| {
            // 退出时必须收掉通话助手进程：它是 spawn 出来的独立进程，主程序结束
            // 不会带走它。留着就是一个占着麦克风的孤儿进程 —— 表现为应用已关闭
            // 而系统的麦克风指示灯还亮着，且下次通话拿不到设备
            #[cfg(target_os = "linux")]
            if matches!(event, tauri::RunEvent::Exit) {
                native_rtc::shutdown();
            }
            let _ = &event;
        });
}
