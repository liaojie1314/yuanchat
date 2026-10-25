//! 打开应用自有目录下的本地文件。
//!
//! 为什么需要这组命令：下载落在应用私有目录后，用户在文件管理器里**看不见它**
//! —— 对用户来说文件等于消失了。桌面端交给系统默认应用打开，安卓端走
//! `Intent.ACTION_VIEW` + FileProvider（私有目录的 `file://` URI 从
//! Android 7 起不允许跨应用传递，必须经 content:// 授权）。
//!
//! `install_apk` 是同一个 Intent，只是把 mime 固定成
//! `application/vnd.android.package-archive` —— 两者合成一处，
//! 一份 FileProvider 配置两处受益（Task 1 研究文档第 2 节）。
//!
//! # 安卓的打开路径
//!
//! Rust 侧不自己发 Intent，而是经 `run_mobile_plugin` 调进 gen/android 里
//! 手写的 [`LocalFilePlugin`] Kotlin 插件 —— 与 shell 插件 `open` 的实现同一条
//! 通道（`lib.rs` 里 `open_external` 的注释记着：插件的 **Rust** API 才有
//! mobile 分支，本模块照这个已验证的模式走）。Kotlin 侧负责
//! FileProvider 换 URI 与 `FLAG_GRANT_READ_URI_PERMISSION`。

use std::path::{Path, PathBuf};
use tauri::Manager;

/// 把前端给的路径限制在应用自有目录之下。
///
/// 这个命令对 WebView 里的代码完全开放，不卡目录等于把「打开任意本地文件」
/// 的能力交出去 —— 与 `open_external` 把 scheme 卡死在 http(s) 是同一个顾虑。
/// 只放行 app_data / app_cache / download 三处，且用 canonicalize 之后再比，
/// 否则 `../` 能走出去。
fn ensure_app_owned(app: &tauri::AppHandle, path: &str) -> Result<PathBuf, String> {
    let resolver = app.path();
    let mut roots: Vec<PathBuf> = Vec::new();
    for r in [resolver.app_data_dir(), resolver.app_cache_dir(), resolver.download_dir()] {
        if let Ok(p) = r {
            if let Ok(c) = p.canonicalize() {
                roots.push(c);
            }
        }
    }
    let target = Path::new(path)
        .canonicalize()
        .map_err(|e| format!("path not accessible: {e}"))?;
    if roots.iter().any(|root| target.starts_with(root)) {
        Ok(target)
    } else {
        Err("path outside app-owned directories".into())
    }
}

/// 用系统默认应用打开本地文件。
///
/// @param path - 绝对路径，必须落在应用自有目录下
/// @param mime - 安卓 Intent 需要；桌面端忽略
#[tauri::command]
pub fn open_local_file(
    app: tauri::AppHandle,
    path: String,
    mime: Option<String>,
) -> Result<(), String> {
    let target = ensure_app_owned(&app, &path)?;
    let _ = &mime;
    #[cfg(desktop)]
    {
        use tauri_plugin_shell::ShellExt;
        #[allow(deprecated)]
        return app
            .shell()
            .open(target.to_string_lossy().to_string(), None)
            .map_err(|e| e.to_string());
    }
    #[cfg(mobile)]
    {
        return android_open(&app, &target, mime.as_deref());
    }
}

/// 调系统安装器安装 APK（Android 自动更新用，Task 19 消费）。
///
/// 调用方**必须先校验 sha256**：这里一旦发出 Intent，字节就交给系统
/// PackageInstaller 了，本函数无法再做任何把关。
#[tauri::command]
pub fn install_apk(app: tauri::AppHandle, path: String) -> Result<(), String> {
    open_local_file(app, path, Some("application/vnd.android.package-archive".into()))
}

/// 安卓：经 PluginManager 把打开请求转给 Kotlin 侧的 LocalFilePlugin。
///
/// 路径已在 [`ensure_app_owned`] 卡过目录，Kotlin 侧只做 FileProvider 换 URI
/// 与发 Intent，不再重复校验（两边规则要保持一致，改动需同步）。
#[cfg(target_os = "android")]
fn android_open(
    app: &tauri::AppHandle,
    target: &Path,
    mime: Option<&str>,
) -> Result<(), String> {
    let handle = app.state::<tauri::plugin::PluginHandle<tauri::Wry>>();
    handle
        .run_mobile_plugin::<serde_json::Value>(
            "openLocalFile",
            serde_json::json!({
                "path": target.to_string_lossy(),
                "mime": mime.unwrap_or("*/*"),
            }),
        )
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// iOS：本批未支持（无 Apple 开发者账户，无法打包验证），如实报错而不是装作成功。
#[cfg(all(mobile, not(target_os = "android")))]
fn android_open(_app: &tauri::AppHandle, _target: &Path, _mime: Option<&str>) -> Result<(), String> {
    Err("open_local_file is not available on this platform".into())
}

/// 安卓初始化：把 gen/android 手写的 LocalFilePlugin 注册进 PluginManager。
///
/// `register_android_plugin` 是 `PluginApi` 的方法，只在插件 setup 回调里拿得到，
/// 所以这里用一个无配置的空插件承载注册，PluginHandle 存进 app state，
/// [`android_open`] 再取出来发命令 —— 与 tauri 自带 path 插件注册 PathPlugin
/// 的方式完全一致（tauri 源码 `path/plugin.rs`）。
#[cfg(target_os = "android")]
pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("local-file")
        .setup(|app, api| {
            let handle = api.register_android_plugin("com.yuanchat.desktop", "LocalFilePlugin")?;
            app.manage(handle);
            Ok(())
        })
        .build()
}
