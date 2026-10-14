# Android 落盘目录 / FileProvider / updater 动态端点 —— 核实结论

| 项目     | 值                                                                               |
| -------- | -------------------------------------------------------------------------------- |
| 日期     | 2026-10-11                                                                       |
| 对应任务 | [实施计划](../plans/2026-10-11-tray-palette-ota.md) Task 1（Stage 0 pre-flight） |
| 消费方   | Task 6（`fileSink` Tauri 实现）、Task 19（Android 自动更新）                     |
| 结论     | 三条全部**可行**，无需启用降级方案；另发现两处必须补的清单改动                   |

核实基于本地实际锁定的版本，不是文档推断：

| 包                     | 版本   | 来源                                                      |
| ---------------------- | ------ | --------------------------------------------------------- |
| `tauri`                | 2.11.2 | `apps/desktop/src-tauri/Cargo.lock`                       |
| `tauri-plugin-fs`      | 2.5.1  | 同上                                                      |
| `tauri-plugin-updater` | 2.10.1 | 同上                                                      |
| registry 路径          | —      | `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/` |

---

## 1. Android 的 `BaseDirectory.Download` 落在哪

### 核实命令

```bash
grep -n "Download" ~/.cargo/registry/src/*/tauri-2.11.2/src/path/android.rs
cat ~/.cargo/registry/src/*/tauri-2.11.2/mobile/android/src/main/java/app/tauri/PathPlugin.kt
```

### 实际输出摘要

Rust 侧不自己算路径，一路转给原生插件（`tauri-2.11.2/src/path/android.rs:104`）：

```rust
pub fn download_dir(&self) -> Result<PathBuf> {
  self.call_resolve("getDownloadDir")
}
```

Kotlin 侧才是真正的定义（`mobile/android/.../app/tauri/PathPlugin.kt:78`）：

```kotlin
@Command
fun getDownloadDir(invoke: Invoke) {
    resolvePath(invoke, activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)?.absolutePath)
}
```

### 结论

| 问题             | 答案                                                                   |
| ---------------- | ---------------------------------------------------------------------- |
| 解析到的路径     | `/storage/emulated/0/Android/data/com.yuanchat.desktop/files/Download` |
| 是否需要权限     | **不需要**，任何 API level 都不需要                                    |
| 目录是否自动创建 | **是**，`getExternalFilesDir` 保证目录存在                             |
| 用户可见性       | **不可见**（见下）                                                     |

这是 **app 私有外部存储**（`getExternalFilesDir`），不是公共下载目录
`/storage/emulated/0/Download`。三个后果：

1. **零权限**：app 私有目录被 scoped storage 豁免，不需要
   `WRITE_EXTERNAL_STORAGE`，也不需要 `MANAGE_EXTERNAL_STORAGE`。
   Android 11+ 不会拦。这正合仓库里 `no-native-permission-dialogs` 那条约束 ——
   连权限弹窗都不会出现。
2. **卸载即清**：app 被卸载时系统会连带删掉这个目录。对 APK 缓存是好事，
   对用户下载的文件是意外行为。
3. **文件管理器里基本看不到**：`Android/data/` 在 Android 11+ 被大多数文件管理器
   屏蔽。spec §3.4 「下载完在文件管理器里能找到」这个承诺在安卓上**兑现不了**。

### 对 plan 的影响

**不启用降级方案。** 降级底线写的是「退 `BaseDirectory.AppCache`，只提供打开不提供
文件管理器可见」—— 而 `BaseDirectory.Download` 的实际行为已经就是这样了（只是目录
位置更合语义、且卸载时才清理，比 AppCache 更不容易被系统半路回收）。所以：

- Task 6 照原计划用 `BaseDirectory.Download`，**不改**。
- Task 6 的 Tauri `fileSink` 实现必须把 `save()` 的返回值（绝对路径）如实回给调用方，
  安卓上「打开」按钮是用户触达文件的**唯一**途径，不能像桌面端那样假设用户能自己去翻目录。
- 权限标识符（从 `gen/schemas/mobile-schema.json` 核实，共 716 个标识符中匹配项）：
  `fs:allow-download-write-recursive`、`fs:allow-download-read-recursive`、
  `fs:allow-download-meta-recursive`，作用域 `fs:scope-download-recursive`。
  这些进 `capabilities/mobile.json`。
- **Task 21 登记债**：「安卓下载的文件在系统文件管理器里不可见，且卸载 app 会一并删除」。
  要真正落到公共 `Download/` 目录得走 MediaStore（`MediaStore.Downloads` + `ContentResolver`），
  Tauri 的 fs 插件没有这个能力，需要自写 Kotlin 插件 —— 本批不做。

---

## 2. `gen/android` 是否已带 FileProvider

### 核实命令

```bash
grep -n "FileProvider\|provider\|REQUEST_INSTALL" \
  apps/desktop/src-tauri/gen/android/app/src/main/AndroidManifest.xml
cat apps/desktop/src-tauri/gen/android/app/src/main/res/xml/file_paths.xml
git ls-files apps/desktop/src-tauri/gen/android | wc -l
cat apps/desktop/src-tauri/gen/android/.gitignore apps/desktop/src-tauri/gen/android/app/.gitignore
```

### 实际输出摘要

FileProvider **已经声明好了**（`AndroidManifest.xml:64-72`）：

```xml
<provider
  android:name="androidx.core.content.FileProvider"
  android:authorities="${applicationId}.fileprovider"
  android:exported="false"
  android:grantUriPermissions="true">
  <meta-data
    android:name="android.support.FILE_PROVIDER_PATHS"
    android:resource="@xml/file_paths" />
</provider>
```

`res/xml/file_paths.xml` 也在，内容是：

```xml
<paths xmlns:android="http://schemas.android.com/apk/res/android">
  <external-path name="my_images" path="." />
  <cache-path name="my_cache_images" path="." />
</paths>
```

`git ls-files` 返回 **43 个文件**，`AndroidManifest.xml` 与 `res/xml/file_paths.xml`
**都在版本控制里**。仓库根 `.gitignore:61-66` 与 `apps/desktop/.gitignore:28-34`
都明确写了「不整体忽略 `src-tauri/gen/`」，只忽略 `gen/apple/` 与 `gen/schemas/`；
Tauri 自己在 `gen/android/.gitignore` 和 `gen/android/app/.gitignore` 里排除的
只有构建产物（`build`、`.gradle`、`jniLibs/**/*.so`、`tauri.properties` 等）。

### 结论

| 问题                                   | 答案                                                                  |
| -------------------------------------- | --------------------------------------------------------------------- |
| FileProvider 是否已声明                | **是**，`androidx.core.content.FileProvider`                          |
| `authorities` 的值                     | `${applicationId}.fileprovider` → `com.yuanchat.desktop.fileprovider` |
| `file_paths.xml` 在不在                | **在**，且已被 git 跟踪                                               |
| 不被 `tauri android init` 覆盖的注入点 | **就是这两个文件本身**                                                |

最后一条是本节最重要的结论：`gen/android` 在本仓是**手改并提交**的目录（`MainActivity.kt`
的软键盘适配、`CallForegroundService.kt`、清单里那一堆中文注释的权限声明，都是人写的）。
所以不需要去找什么模板注入点 —— 直接改这两个文件即可，`tauri android init` 真要覆盖了，
`git diff` 当场就能看出来。这也是本仓既有的工作方式，照做即可。

现有 `<external-path path="." />` 映射到 `Environment.getExternalStorageDirectory()`
= `/storage/emulated/0`，第 1 节那个下载目录按路径前缀**已经落在它之下**，
所以严格说现状就能用。但那是在依赖 FileProvider 的路径前缀匹配细节，不如显式声明。

### 对 plan 的影响

**不启用降级方案**（`install_apk` 不需要退化成「提示用户手动点通知栏」）。Task 6 / Task 19
需要补两处清单改动，都写进 Task 6：

1. `res/xml/file_paths.xml` 增一条，精确对准第 1 节那个目录（
   `<external-files-path>` 映射的是 `getExternalFilesDir(null)`，`path="Download"`
   刚好拼出 `.../files/Download`）：

   ```xml
   <!-- 应用内下载与 OTA 的 APK 落盘目录。对应 BaseDirectory.Download，
        即 getExternalFilesDir(DIRECTORY_DOWNLOADS)。安装器与第三方应用
        只能通过 FileProvider 的 content:// URI 读到它 -->
   <external-files-path name="app_downloads" path="Download" />
   ```

2. `AndroidManifest.xml` 增一条权限 —— 现状**没有** `REQUEST_INSTALL_PACKAGES`，
   不加这条 `Intent.ACTION_VIEW` 拉安装器会被系统直接拒绝：

   ```xml
   <!-- OTA 自动更新：下载完 APK 后拉起系统安装器。Android 8+ 起这是
        per-app 的「安装未知应用」开关，清单不声明则 startActivity 直接被拒 -->
   <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />
   ```

   注意这只是让「可以申请」，用户仍需在系统设置里给本应用开「安装未知应用」。
   首次安装会被系统弹窗引导，**这是系统安装器自己的流程，不属于
   `no-native-permission-dialogs` 要自绘的范畴**（我们没法自绘 PackageInstaller）。
   Task 19 的 UI 要在点「立即更新」前先说明这一步，别让用户以为卡住了。

3. `install_apk` 的 Rust 实现拿 URI 时必须走 FileProvider（`FLAG_GRANT_READ_URI_PERMISSION`），
   不能直接传 `file://` —— Android 7+ 传 `file://` 会抛 `FileUriExposedException`。

---

## 3. `tauri-plugin-updater` 的动态端点格式与 204 语义

### 核实命令

```bash
P=~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-plugin-updater-2.10.1
sed -n '1382,1428p' $P/src/updater.rs   # RemoteRelease 的手写 Deserialize
sed -n '480,495p'   $P/src/updater.rs   # 204 处理
sed -n '425,445p'   $P/src/updater.rs   # URL 占位符替换
sed -n '1324,1352p' $P/src/updater.rs   # updater_os / updater_arch
sed -n '568,598p'   $P/src/updater.rs   # get_urls：platforms 的键怎么查
```

### 实际输出摘要

`RemoteRelease` 是**手写** `Deserialize`（`updater.rs:1382`），不是 serde 的
`untagged` 自动派发 —— 判别依据是 `platforms` 字段**在不在**：

```rust
#[derive(Deserialize)]
struct InnerRemoteRelease {
    #[serde(alias = "name", deserialize_with = "parse_version")]
    version: Version,
    notes: Option<String>,
    pub_date: Option<String>,
    platforms: Option<HashMap<String, ReleaseManifestPlatform>>,
    // dynamic platform response
    url: Option<Url>,
    signature: Option<String>,
}
// ...
data: if let Some(platforms) = release.platforms {
    RemoteReleaseInner::Static { platforms }
} else {
    RemoteReleaseInner::Dynamic(ReleaseManifestPlatform {
        url: release.url.ok_or_else(|| DeError::custom("the `url` field was not set on the updater response"))?,
        signature: release.signature.ok_or_else(|| DeError::custom("the `signature` field was not set on the updater response"))?,
    })
},
```

204 在 JSON 解析**之前**判掉（`updater.rs:483-487`）：

```rust
if res.status().is_success() {
    // no updates found!
    if StatusCode::NO_CONTENT == res.status() {
        log::debug!("update endpoint returned 204 No Content");
        return Ok(None);
    };
    let update_response: serde_json::Value = res.json().await?;
```

### 结论

**动态（Server）格式的确切字段名**：

| 字段        | 必填 | 类型                         | 备注                                                   |
| ----------- | ---- | ---------------------------- | ------------------------------------------------------ |
| `version`   | ✅   | semver 字符串                | 别名 `name` 也认（`serde(alias = "name")`）            |
| `url`       | ✅   | URL 字符串                   | 缺了直接反序列化失败                                   |
| `signature` | ✅   | minisign `.sig` **文件内容** | 不是 URL，是签名文本本身；缺了直接反序列化失败         |
| `notes`     | ⬜   | 字符串                       | 更新说明，前端 `UpdateChecker` 展示                    |
| `pub_date`  | ⬜   | **RFC3339** 字符串           | 格式不对会让**整个响应**反序列化失败，不是忽略该字段   |
| `platforms` | ⬜   | map                          | **一旦出现就切到 static 格式**，所以动态端点绝不能带它 |

**`platforms` map 可省** —— 省掉它正是选择动态格式的方式。

**无更新时返 204 No Content**，返同版本号也行（`release.version > self.current_version`
为假 → `Ok(None)`），但 204 更省一次 JSON 构造，且不必编一个假的 `url`/`signature`
来过反序列化。**对外端点一律返 204。**

**占位符的实际取值**（`updater.rs:425-445`，URL-encoded 的 `%7B%7B...%7D%7D` 变体也会被替换）：

| 占位符                | 取值                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `{{target}}`          | `linux` / `darwin` / `windows` —— **只有 OS，不含 arch**；macOS 是 `darwin` 不是 `macos` |
| `{{arch}}`            | `i686` / `x86_64` / `armv7` / `aarch64` / `riscv64`                                      |
| `{{current_version}}` | 当前版本，URL-encoded                                                                    |
| `{{bundle_type}}`     | `appimage` / `deb` / `rpm` / `app` / `msi` / `nsis`                                      |

⚠️ **一个真实的坑**：URL 里的 `{{target}}` 与 static 格式 `platforms` 的**键不是一回事**。
`get_urls`（`updater.rs:578-595`）按 `{os}-{arch}-{installer}`、再 `{os}-{arch}` 的顺序查
（即 `linux-x86_64-deb`、`linux-x86_64`），而 URL 占位符 `{{target}}` 只替换成 `linux`。
走动态格式时这个坑不存在（`download_url()` 对 Dynamic 分支直接返 `platform.url`，
压根不看 target），但万一将来退回 static 格式，端点必须按 `{os}-{arch}` 组键。

**Android：插件压根不支持。** `updater_os()`（`updater.rs:1324-1336`）只认
linux / macos / windows，其余返 `None` → `check()` 以 `Error::UnsupportedOs` 失败。
本仓的 `apps/desktop/src-tauri/Cargo.toml:49-52` 早就按这个事实分组引入了：

```toml
[target."cfg(not(any(target_os = \"android\", target_os = \"ios\")))".dependencies]
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
```

### 对 plan 的影响

**不启用降级方案**（对外端点不必改成完整 `platforms` map）。具体锁定：

- Task 17 的桌面端点返动态格式：`{version, notes, pub_date, url, signature}`，
  **不带 `platforms`**；无更新返 **204**，响应体留空。
- `pub_date` 用 Go 的 `time.RFC3339` 格式化。**这是硬要求** —— 格式不对会让整个
  更新检查失败，而不是丢一个字段。Task 17 的测试要钉住这条。
- Task 19 的 Android 更新流程**必须**自己实现（下载 APK + 校验 sha256 + `install_apk`），
  不是「为了简单起见自己写」，而是插件在安卓上根本编译不进去。Android 的更新检查
  走 Task 10 那个普通 `fetch`，与 updater 插件零关系。
- Task 19 改 `tauri.conf.json` 的 `plugins.updater.endpoints` 时，现状是单条
  GitHub `releases/latest/download/latest.json`。spec 要求的「自建优先、GitHub 兜底」
  靠 endpoints 数组的**顺序遍历**天然成立 —— `check()` 对每个 endpoint 依次请求，
  第一个成功解析出 release 的就 `break`（`updater.rs:450-518`）。
  自建端点放第一条，GitHub 留第二条。
  ⚠️ 但注意：自建端点返 **204 时会直接 `return Ok(None)`**，**不会**继续试
  GitHub。所以 204 的语义是「我确定没有更新」，而不是「我不知道，你问下一个」。
  自建服务查不到版本记录时该返 204（确定没有），只在**自身故障**时返 5xx
  才会让 updater 落到 GitHub 兜底。Task 17 要按这个区分写。

---

## 4. 本 Task 产出的清单改动汇总

给 Task 6 / Task 17 / Task 19 的实现者直接抄：

| 文件                                              | 改动                                                                                                           | 归属    |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------- |
| `gen/android/app/src/main/res/xml/file_paths.xml` | 增 `<external-files-path name="app_downloads" path="Download" />`                                              | Task 6  |
| `gen/android/app/src/main/AndroidManifest.xml`    | 增 `REQUEST_INSTALL_PACKAGES` 权限                                                                             | Task 6  |
| `src-tauri/capabilities/mobile.json`              | 增 `fs:allow-download-write-recursive` / `-read-recursive` / `-meta-recursive` + `fs:scope-download-recursive` | Task 6  |
| `src-tauri/src/local_file.rs`                     | `install_apk` 走 FileProvider `content://` URI + `FLAG_GRANT_READ_URI_PERMISSION`                              | Task 6  |
| `server/internal/handler/update.go`               | 桌面端点动态格式、无更新返 204、`pub_date` 用 RFC3339                                                          | Task 17 |
| `src-tauri/tauri.conf.json`                       | `endpoints` 自建放第一条、GitHub 第二条                                                                        | Task 19 |

新增一条债，Task 21 登记进 MASTER_PLAN：

> 安卓下载的文件落在 app 私有外部存储（`Android/data/<pkg>/files/Download`），
> 系统文件管理器里不可见，且卸载应用会一并删除。要落到公共 `Download/` 需走
> MediaStore（`MediaStore.Downloads` + `ContentResolver`），Tauri fs 插件无此能力，
> 须自写 Kotlin 插件。
