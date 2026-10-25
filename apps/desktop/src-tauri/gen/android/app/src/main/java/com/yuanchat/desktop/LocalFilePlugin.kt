package com.yuanchat.desktop

import android.app.Activity
import android.content.Intent
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import java.io.File

/**
 * 本地文件打开插件：Rust 侧 `local_file.rs` 的 `open_local_file` 命令经
 * `run_mobile_plugin("openLocalFile", …)` 调到这里（与 tauri 自带 shell 插件
 * 的 Kotlin 侧同一条 PluginManager 通道，注册见 `local_file.rs::init`）。
 *
 * 为什么不沿用 shell 插件的 open：它只会 `Uri.parse(url)` 发 `file://`，
 * 而 Android 7 起跨应用传 `file://` 抛 `FileUriExposedException`，且应用私有
 * 目录的文件别的进程本来就读不了 —— 必须经 FileProvider 换成 `content://`
 * 并带 `FLAG_GRANT_READ_URI_PERMISSION`（Task 1 研究文档第 2 节）。
 *
 * 安装 APK（OTA 自动更新）也走这同一个方法：mime 固定
 * `application/vnd.android.package-archive`，系统 PackageInstaller 自会接手。
 */
@TauriPlugin
class LocalFilePlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun openLocalFile(invoke: Invoke) {
    try {
      val args = invoke.getArgs()
      val path = args.getString("path")
      val mime = args.getString("mime", "*/*")
      if (path.isEmpty()) {
        invoke.reject("path is empty")
        return
      }
      // authority 与 AndroidManifest.xml 里 FileProvider 的声明保持一致；
      // 用 packageName 而不是写死包名，debug 构建的 .debug 后缀也能对上
      val uri =
        FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", File(path))
      val intent =
        Intent(Intent.ACTION_VIEW).apply {
          setDataAndType(uri, mime)
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
      activity.startActivity(intent)
      invoke.resolve()
    } catch (ex: Exception) {
      // getUriForFile 在路径不在 file_paths.xml 范围内时抛 IllegalArgumentException，
      // 没有能处理该 mime 的应用时 startActivity 抛 ActivityNotFoundException ——
      // 都如实回给前端，让 UI 报「打开失败」而不是静默无反应
      invoke.reject(ex.message ?: ex.toString())
    }
  }
}
