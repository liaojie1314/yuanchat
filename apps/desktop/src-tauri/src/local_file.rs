//! 打开应用自有目录下的本地文件。
//!
//! 为什么需要这组命令：下载落在应用私有目录后，用户在文件管理器里**看不见它**
//! —— 对用户来说文件等于消失了。桌面端打开文件所在文件夹，安卓端走
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

/// 下载目录偏好只由原生目录选择器写入；保留旧授权供历史下载定位使用。
#[derive(Default, serde::Serialize, serde::Deserialize)]
struct DownloadPreferences {
    current: Option<PathBuf>,
    authorized: Vec<PathBuf>,
}

/// 设置页显示的实际下载目录。
#[derive(serde::Serialize)]
pub struct DownloadDirectory {
    path: PathBuf,
    custom: bool,
}

/// 从本机配置恢复目录；损坏或不可读的配置显式报错，避免静默改写下载位置。
fn read_download_preferences(path: &Path) -> Result<DownloadPreferences, String> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(DownloadPreferences::default()),
        Err(e) => Err(e.to_string()),
    }
}

/// 先写临时文件再替换偏好，保存失败时保留原配置。
fn write_download_preferences(path: &Path, value: &DownloadPreferences) -> Result<(), String> {
    std::fs::create_dir_all(path.parent().ok_or("invalid preferences path")?)
        .map_err(|e| e.to_string())?;
    let temporary = path.with_extension("tmp");
    let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    std::fs::write(&temporary, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&temporary, path).map_err(|e| e.to_string())
}

/// 原生配置文件与 WebView 的浏览器存储分离。
fn download_preferences_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("download-directory.json"))
}

/// 恢复用户通过目录选择器授予的范围，供重启后的历史文件检查使用。
fn restore_download_scope(
    app: &tauri::AppHandle,
    preferences: &DownloadPreferences,
) -> Result<(), String> {
    use tauri_plugin_fs::FsExt;
    for path in &preferences.authorized {
        if !path.is_absolute() {
            return Err("download directory must be absolute".into());
        }
        app.fs_scope()
            .allow_directory(path, true)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 读取下载目录并恢复本机授权；Android 仍返回应用私有的默认目录。
#[tauri::command]
pub fn get_download_directory(app: tauri::AppHandle) -> Result<DownloadDirectory, String> {
    let preferences = read_download_preferences(&download_preferences_path(&app)?)?;
    restore_download_scope(&app, &preferences)?;
    let custom = preferences.current.is_some();
    let path = match preferences.current {
        Some(path) => path,
        None => app.path().download_dir().map_err(|e| e.to_string())?,
    };
    Ok(DownloadDirectory { path, custom })
}

/// 用户主动选择目录后才持久化授权；取消保留原设置，不允许前端直接提交任意路径。
#[tauri::command]
pub async fn choose_download_directory(
    app: tauri::AppHandle,
) -> Result<Option<DownloadDirectory>, String> {
    #[cfg(desktop)]
    {
        use tauri_plugin_dialog::DialogExt;
        // 原生对话框不能阻塞 UI 线程，选择结果与配置写入在阻塞工作线程内完成。
        tauri::async_runtime::spawn_blocking(move || {
            let Some(selected) = app.dialog().file().blocking_pick_folder() else {
                return Ok(None);
            };
            let path = selected
                .into_path()
                .map_err(|e| e.to_string())?
                .canonicalize()
                .map_err(|e| e.to_string())?;
            if !path.is_dir() {
                return Err("download directory is not a folder".into());
            }
            let config = download_preferences_path(&app)?;
            let mut preferences = read_download_preferences(&config)?;
            if !preferences.authorized.contains(&path) {
                preferences.authorized.push(path.clone());
            }
            preferences.current = Some(path.clone());
            restore_download_scope(&app, &preferences)?;
            write_download_preferences(&config, &preferences)?;
            Ok(Some(DownloadDirectory { path, custom: true }))
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(mobile)]
    {
        let _ = app;
        Err("custom download directories are unavailable on mobile".into())
    }
}

/// 恢复后续下载的默认目录，保留旧目录授权以便打开既有下载。
#[tauri::command]
pub fn reset_download_directory(app: tauri::AppHandle) -> Result<DownloadDirectory, String> {
    let config = download_preferences_path(&app)?;
    let mut preferences = read_download_preferences(&config)?;
    preferences.current = None;
    write_download_preferences(&config, &preferences)?;
    get_download_directory(app)
}

/// 把前端给的路径限制在应用自有目录之下。
///
/// 这个命令对 WebView 里的代码完全开放，不卡目录等于把「打开任意本地文件」
/// 的能力交出去 —— 与 `open_external` 把 scheme 卡死在 http(s) 是同一个顾虑。
/// 只放行应用目录、默认下载目录和用户选择过的下载目录，且 canonicalize 后再比，
/// 否则 `../` 能走出去。
fn ensure_app_owned(app: &tauri::AppHandle, path: &str) -> Result<PathBuf, String> {
    let resolver = app.path();
    let mut roots: Vec<PathBuf> = Vec::new();
    for r in [
        resolver.app_data_dir(),
        resolver.app_cache_dir(),
        resolver.download_dir(),
    ] {
        if let Ok(p) = r {
            if let Ok(c) = p.canonicalize() {
                roots.push(c);
            }
        }
    }
    #[cfg(desktop)]
    for path in read_download_preferences(&download_preferences_path(app)?)?.authorized {
        if let Ok(root) = path.canonicalize() {
            roots.push(root);
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

/// 桌面打开本地文件所在文件夹，移动端用系统默认应用打开文件。
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
            .open(
                target
                    .parent()
                    .ok_or("file has no parent directory")?
                    .to_string_lossy()
                    .to_string(),
                None,
            )
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
    open_local_file(
        app,
        path,
        Some("application/vnd.android.package-archive".into()),
    )
}

/// 安卓：经 PluginManager 把打开请求转给 Kotlin 侧的 LocalFilePlugin。
///
/// 路径已在 [`ensure_app_owned`] 卡过目录，Kotlin 侧只做 FileProvider 换 URI
/// 与发 Intent，不再重复校验（两边规则要保持一致，改动需同步）。
#[cfg(target_os = "android")]
fn android_open(app: &tauri::AppHandle, target: &Path, mime: Option<&str>) -> Result<(), String> {
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
fn android_open(
    _app: &tauri::AppHandle,
    _target: &Path,
    _mime: Option<&str>,
) -> Result<(), String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    /// 各用例独占临时配置，避免覆盖真实用户目录偏好。
    fn test_config(label: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir()
            .join(format!(
                "yuanchat-directory-{}-{label}-{unique}",
                std::process::id()
            ))
            .join("settings.json")
    }

    #[test]
    fn restores_selected_directory_and_keeps_previous_authorizations_on_reset() {
        let config = test_config("restore");
        let a = config.parent().unwrap().join("A");
        let b = config.parent().unwrap().join("B");
        let preferences = DownloadPreferences {
            current: Some(b.clone()),
            authorized: vec![a.clone(), b.clone()],
        };
        write_download_preferences(&config, &preferences).unwrap();
        let mut restored = read_download_preferences(&config).unwrap();
        assert_eq!(restored.current, Some(b.clone()));
        assert_eq!(restored.authorized, vec![a.clone(), b.clone()]);
        restored.current = None;
        write_download_preferences(&config, &restored).unwrap();
        let reset = read_download_preferences(&config).unwrap();
        assert!(reset.current.is_none());
        assert_eq!(reset.authorized, vec![a, b]);
        std::fs::remove_dir_all(config.parent().unwrap()).unwrap();
    }

    #[test]
    fn failed_write_preserves_existing_preferences() {
        let config = test_config("failed-write");
        let old = config.parent().unwrap().join("original");
        write_download_preferences(
            &config,
            &DownloadPreferences {
                current: Some(old.clone()),
                authorized: vec![old.clone()],
            },
        )
        .unwrap();
        std::fs::create_dir(config.with_extension("tmp")).unwrap();
        assert!(write_download_preferences(&config, &DownloadPreferences::default()).is_err());
        assert_eq!(
            read_download_preferences(&config).unwrap().current,
            Some(old)
        );
        std::fs::remove_dir_all(config.parent().unwrap()).unwrap();
    }

    #[test]
    fn missing_preferences_use_default_but_corrupt_preferences_fail() {
        let config = test_config("invalid");
        assert!(read_download_preferences(&config)
            .unwrap()
            .current
            .is_none());
        std::fs::create_dir_all(config.parent().unwrap()).unwrap();
        std::fs::write(&config, b"broken").unwrap();
        assert!(read_download_preferences(&config).is_err());
        std::fs::remove_dir_all(config.parent().unwrap()).unwrap();
    }
}
