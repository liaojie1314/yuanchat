# 发版指南

本文档说明 YuanChat 应用发版流程 —— 从 tag 到多平台安装包。

## 一、一次性准备（首次发版前）

### 1. GitHub Secrets 配置

在 `https://github.com/liaojie1314/yuanchat/settings/secrets/actions` 添加以下 Secrets（**只在首次配置一次**）：

| Secret 名                            | 值                         | 说明                                      |
| ------------------------------------ | -------------------------- | ----------------------------------------- |
| `ANDROID_KEYSTORE_BASE64`            | 见下方"获取 base64"步骤    | Android release keystore 的 base64 编码   |
| `ANDROID_KEYSTORE_PASSWORD`          | `yuanchat_release_2026`    | keystore 密码（**发版后请改为你自己的**） |
| `ANDROID_KEY_ALIAS`                  | `yuanchat`                 | 密钥别名                                  |
| `ANDROID_KEY_PASSWORD`               | `yuanchat_release_2026`    | 密钥密码                                  |
| `TAURI_SIGNING_PRIVATE_KEY`          | 见下方"桌面自动更新签名"   | updater 包签名私钥（自签，免费）          |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 生成时设的密码（无则留空） | 私钥密码                                  |

**不需要**：

- `GITHUB_TOKEN` —— Actions 自动提供
- macOS/Windows **OS 层**代码签名 secrets —— 需付费证书，未配置时 CI 正常出包（仅带系统警告）：
  - `APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_SIGNING_IDENTITY`
  - `APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID`（notarize 用）
  - `WINDOWS_CERTIFICATE`、`WINDOWS_CERTIFICATE_PASSWORD`

> **两种签名不要混淆**：
>
> | 类型                         | 用途                                             | 成本                            | 现状        |
> | ---------------------------- | ------------------------------------------------ | ------------------------------- | ----------- |
> | **updater 签名**（minisign） | 自动更新包完整性校验，客户端拒装未签名包         | **免费自签**                    | ✅ 已启用   |
> | **OS 代码签名**              | 消除 macOS Gatekeeper / Windows SmartScreen 警告 | Apple $99/y、Windows OV ~$200/y | ⏳ 待购证书 |
>
> 二者相互独立：没有付费证书也能发布带签名校验的自动更新。

### 1.1 桌面自动更新签名（自签，免费）

updater 用 minisign 密钥对：私钥签包（CI 用），公钥内置在客户端校验。

```bash
# 生成密钥对（私钥务必存仓库外；本项目生成于 ~/.config/yuanchat/）
pnpm --filter @yuanchat/desktop exec tauri signer generate -w ~/.config/yuanchat/updater.key

# 私钥内容 → GitHub Secret TAURI_SIGNING_PRIVATE_KEY
cat ~/.config/yuanchat/updater.key
```

公钥已写入 `apps/desktop/src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`（可入库，公开无风险）。

- 更新源：自建服务器最多尝试两次，检查失败才尝试一次 GitHub `latest.json`；明确无更新的 `204` 立即停止，保留灰度与回滚决定。部署方式见[自建 OTA 更新源](#自建-ota-更新源)
- 客户端入口：设置 → 关于 → 「检查更新」（`apps/desktop/src/components/UpdateChecker.tsx`）
- ⚠️ **私钥丢失** = 已安装的旧版客户端再也无法验证新包，只能让用户手动重装

> Windows 也可用自签证书（`New-SelfSignedCertificate`）走 OS 签名，但**不能**消除
> SmartScreen 警告（需受信任 CA 签发 + 声誉积累），故本项目不做自签 OS 证书。

### 2. Android Keystore 生成与获取 base64

**如果你已经有 keystore**（我在项目初始化时已生成一份在 `/tmp/yc-release/release.keystore`）：

```bash
base64 -w0 /tmp/yc-release/release.keystore
# 复制输出，粘贴到 GitHub Secret ANDROID_KEYSTORE_BASE64
```

**如果需要重新生成**（推荐正式发版前用你自己的密码重新生成）：

```bash
mkdir -p ~/.yuanchat-secrets && cd ~/.yuanchat-secrets

# 生成 keystore（改你自己的密码）
keytool -genkeypair \
  -alias yuanchat \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass 你的存储密码 \
  -keypass 你的密钥密码 \
  -dname "CN=YuanChat,OU=Dev,O=YuanChat,L=Shanghai,ST=SH,C=CN" \
  -keystore release.keystore

# 生成 base64 用于 GitHub Secret
base64 -w0 release.keystore

# ⚠️ 妥善保管：keystore 丢失或密码遗忘 = 你无法再发布同一签名的 APK 更新（用户须卸载重装）
```

### 3. Sentry 错误监控（可选）

在同一 Secrets 页面添加以下 4 个 Secret（未配置时 CI 构建正常通过，仅跳过 source map 上传）：

| Secret 名                | 值                                       | 说明                       |
| ------------------------ | ---------------------------------------- | -------------------------- |
| `SENTRY_AUTH_TOKEN`      | 从 Sentry 「Settings → Auth Tokens」创建 | 用于上传 source maps       |
| `SENTRY_ORG`             | Sentry 组织 slug                         | 你在 Sentry 创建的组织标识 |
| `SENTRY_PROJECT_WEB`     | Sentry Web 项目 slug                     | Web 端项目名               |
| `SENTRY_PROJECT_DESKTOP` | Sentry Desktop 项目 slug                 | 桌面端项目名               |

**注册 Sentry：** 访问 https://sentry.io/signup/ 注册，创建 React 类型项目，在项目设置「Client Keys (DSN)」中复制 DSN，配置到各端 `.env` 文件的 `VITE_SENTRY_DSN=` 字段。

### 4. `.release-it.json` 配置

已配置好（`requireBranch: "main"`），无需改动。首次运行会自动生成 `CHANGELOG.md`。

## 二、发版流程（每次发版执行）

### Step 1：本地验证通过后合并到 main

先完成下方本地打包门禁及项目完整本地 CI，再合并已验证的开发分支。常规发布从 `dev` 合入；生产补丁可从对应 `fix/*` 分支合入。保留独立提交，不 squash。

```bash
git checkout main
git pull --ff-only
git merge --no-ff dev -m "chore(release): merge verified development changes"
```

### Step 2：运行 release-it 打 tag + 创建 GitHub Release

```bash
# 在 main 分支
pnpm release            # 交互式选版本号（patch/minor/major）
# 或指定：
pnpm release:patch      # v0.1.0 → v0.1.1
pnpm release:minor      # v0.1.0 → v0.2.0
pnpm release:major      # v0.1.0 → v1.0.0
pnpm release:dry        # 模拟运行，看会做什么
```

release-it 会：

1. 提示确认版本号
2. 更新 `package.json` `apps/*/package.json` `tauri.conf.json` 的 version 字段
3. 生成/更新 `CHANGELOG.md`（angular 规范）
4. commit + tag + push
5. 在 GitHub 创建 Release（草稿态）

### Step 3：GitHub Actions 自动打包

tag push 触发 `.github/workflows/release.yml`，并行构建 5 个平台：

| 平台            | Runner         | 产物                                                   |
| --------------- | -------------- | ------------------------------------------------------ |
| Web             | ubuntu-latest  | `yuanchat-web-vX.Y.Z.tar.gz`（Vite dist）              |
| Linux Desktop   | ubuntu-22.04   | `.deb` + `.AppImage` + `.rpm`                          |
| Windows Desktop | windows-latest | `.msi` + `.exe`                                        |
| macOS Desktop   | macos-latest   | `.dmg`（universal，Intel + Apple Silicon 合一）        |
| Android         | ubuntu-22.04   | 四个分架构签名 APK + 一个包含全部 ABI 的 universal APK |

macOS 另有 OTA 使用的 `.app.tar.gz`。除 `.dmg` 外的桌面产物还各带一个 `.sig`（updater 的 minisign 签名），
另有一份 `latest.json` 记录各平台更新地址 —— 它由**每个 desktop job 分别上传**，
tauri-action 会先读回 Release 上已有的那份再合并自己的平台键，
所以三端分先后跑完也不会互相覆盖。验收仍须确认完整的安装格式键：Linux 的 `appimage/deb/rpm`、Windows 的 `msi/nsis`，以及 macOS 两种架构的 `app`；不要仅凭 Release 页面已出现判断打包成功。

Linux runner 钉在 `ubuntu-22.04` 而非 latest：产物的 glibc 下限跟着构建机走，
换 24.04 会从 2.35 抬到 2.39，老发行版用户直接装不上。

产物自动 attach 到对应的 GitHub Release。全程约 20-30 分钟。

### Step 4：确认全部产物就绪

到 `https://github.com/liaojie1314/yuanchat/releases` 找到刚创建的 Release：

- 确认 Web、桌面三平台、Android 共五个 job 全部成功，20 个产物（含 `latest.json`、签名与通用 APK）齐全
- 编辑 Release notes（release-it 已按 CHANGELOG 生成）
- desktop job 配置 `releaseDraft: false`，可能在其他 job 结束前公开 Release；若仍为草稿再点 "Publish release"
- 检查 `latest.json` 的精确安装格式键与 `.sig`、产物 URL 一一对应，再构建本地 Docker 镜像、镜像安装包并部署

## 三、部署说明

### Web 部署

```bash
tar xzf yuanchat-web-vX.Y.Z.tar.gz
# 用任意静态服务器托管解压后的目录
# nginx 示例：
cp -r dist/* /var/www/yuanchat/
```

**注意**：Web 端需要指向后端 API + WS。构建时通过环境变量注入：

```bash
VITE_API_BASE_URL=https://api.your-domain.com \
VITE_WS_URL=wss://ws.your-domain.com \
pnpm --filter @yuanchat/web build
```

### Desktop 安装

- Linux `.AppImage`：`chmod +x yuanchat*.AppImage && ./yuanchat*.AppImage`
- Linux `.deb`：`sudo dpkg -i yuanchat*.deb`
- Windows `.msi`：双击安装（无 OS 签名会有 SmartScreen 警告，点"仍要运行"）
- macOS `.dmg`：拖到 Applications（无 OS 签名会有 Gatekeeper 警告，右键"打开"或系统偏好设置 → 安全性放行）

**自动更新**：安装后在「设置 → 关于 → 检查更新」可拉取新版本。更新包经
minisign 公钥校验，签名不匹配则拒绝安装（防篡改）；下载完成后点「重启应用」生效。

### Android APK

- 用浏览器/文件管理器安装（首次需在设置里开启"未知来源"）
- 四个分架构 APK 适合首次下载安装；通用 APK 含 arm64-v8a / armeabi-v7a / x86 / x86_64，供现有共用 `android/aarch64` 更新槽的客户端升级
- 所有 APK 必须使用同一发布 keystore 签名，系统才允许保留数据升级；上架 Play 另需 Google Play Console upload key

### 自建 OTA 更新源

桌面与 Android 的检查顺序固定为「服务器 → 服务器 → GitHub」，每次检查超时 10 秒。
第一次成功就停止；服务器返回 `204` 表示无更新或未命中灰度，不能再查 GitHub 绕过这个决定。
只有网络、HTTP 或无效元数据等检查失败才继续。此策略适用于包含该修复的新客户端；
服务器部署不能改变旧安装包内置的更新地址，也不会新增启动时自动弹窗。

1. 等待该 tag 的全部 GitHub 打包 job 成功，从对应 Release 获取安装包、`.sig` 和 `latest.json`，逐项校验文件大小与 GitHub asset 的 SHA-256。
2. 将原始文件镜像到现有 MinIO bucket 的 `releases/vX.Y.Z/`，记录实际 object key。保持对象私有，由 `/updates` 端点签发下载 URL，无需开放整个 bucket。聊天文件 GC 始终跳过 `releases/`；历史发行产物由运维单独管理，回滚不删除安装包。
3. 通过管理端 Releases API 登记相同版本与渠道，先发布安装格式变体，再发布基础记录。`sha256`、`size` 来自已校验的真实文件；桌面 `signature` 必须使用对应文件的 `.sig`，不能将 AppImage 签名用于 Deb。

| 平台    | 基础 `arch`                                | 安装格式变体 `arch`                             | 基础记录的下载包            |
| ------- | ------------------------------------------ | ----------------------------------------------- | --------------------------- |
| Linux   | `x86_64`                                   | `x86_64-appimage` / `x86_64-deb` / `x86_64-rpm` | AppImage                    |
| Windows | `x86_64`                                   | `x86_64-msi` / `x86_64-nsis`                    | MSI                         |
| macOS   | `universal`（或精确 `aarch64` / `x86_64`） | `universal-app`（或对应精确架构 `*-app`）       | DMG；变体登记 `.app.tar.gz` |
| Android | `aarch64`                                  | 无                                              | 签名通用 APK                |

基础记录统一控制发布、版本、灰度与回滚。桌面请求附 `bundle_type`，服务器只返回同版、
已发布且命中灰度的精确安装格式；缺失或不可用时返回 `204`。旧客户端未附格式时返回
完整精确键 `platforms`，不会拿通用平台键误发另一种安装包。Android 仍返回平面动态 JSON。
协议与登记字段见 [CHAT_API](CHAT_API.md)。

Android 的 GitHub 兜底只读取官方仓库的稳定版与通用 APK，校验版本、文件名、大小和
SHA-256 元数据；API/CDN 下载用 Android 原生 HTTP，逐跳限制为官方资源地址，避免
Release CDN 无 CORS 导致 WebView 下载失败。GitHub 请求不附带服务器登录令牌或设备标识。

部署后需验证：旧版本能获得对应格式的新包、当前版本与灰度排除返回 `204`、下载校验
通过，以及实际完成安装并在重启后显示新版本。仅看见更新卡片不能算安装验收。

### Docker 镜像与旧版本清理

版本号由 release-it 落定、远端打包成功后，再从该 tag 的干净源码构建
`yuanchat/{server,web,admin}:X.Y.Z`，推到本地 `localhost:5000` registry。
Web/Admin 的版本与服务地址在构建时注入，不能把升版前的镜像重新打新 tag 代替构建。

新镜像验证通过后立即清理本机和本地 registry 中上一版的三类应用镜像、别名与无引用
数据层。只删除本项目的旧版本，不执行会影响其他项目的全局 prune。registry 删除标签
后还需确认无引用数据已回收，不能只删除 `docker image ls` 可见的本机标签。

服务器先备份配置、数据库与对象存储，再加载新镜像、检出对应 tag、更新 `APP_VERSION`、
执行迁移并重建应用容器。升级跨越移除手机号的迁移时，先确认 `ADMIN_EMAIL` 指向原管理员，
停旧后端再迁移。健康检查和 nginx 配置检查通过后重载 nginx；完成部署与 OTA 验证后，
删除服务器上已不用的旧应用容器及镜像。生产仍在使用的镜像必须等替换完成再清理。

## 四、代码签名（未来正式发版补充）

当前 workflow 用 `if` 门控了签名步骤 —— 只要 secrets 存在就自动签，不存在就跳过。

### macOS 签名 + 公证

需 Apple Developer 账户（$99/年）：

1. Xcode 生成 Developer ID Application 证书
2. `base64 Certificates.p12 | pbcopy` → `APPLE_CERTIFICATE`
3. 证书密码 → `APPLE_CERTIFICATE_PASSWORD`
4. 证书 CN（如 `Developer ID Application: Your Name (TEAMID)`) → `APPLE_SIGNING_IDENTITY`
5. Apple ID + app-specific password + Team ID → `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID`

### Windows 签名

需代码签名证书（EV 证书 $300+/年，或 OV 证书 $80+/年）：

1. `.pfx` 证书 → `base64 -w0 cert.pfx` → `WINDOWS_CERTIFICATE`
2. 证书密码 → `WINDOWS_CERTIFICATE_PASSWORD`

## 五、手动补跑（某平台失败时）

Actions 页面 → Release workflow → Run workflow：

| 输入   | 说明                                                                       |
| ------ | -------------------------------------------------------------------------- |
| `tag`  | 必填。产物上传到该 tag 对应的 Release（如 `v0.3.0`）                       |
| `ref`  | 选填。构建代码用的分支/commit，留空用 tag 本身的代码（改了 CI 脚本时有用） |
| `only` | 选填。`all`/`web`/`desktop`/`android`，只补跑失败的平台，避免全量重建      |

> 例：Android 打包失败修复后，`tag=v0.3.0` + `only=android` 即可只重跑 APK，
> 桌面端/Web 已上传的产物不受影响。

> ⚠️ **修的是 CI 脚本本身时，`ref` 必填。** tag 指向的是修复之前那个 commit，
> Actions 页面的「Re-run failed jobs」和留空 `ref` 都会继续用那份坏代码与坏
> workflow 跑，看上去改了却毫无变化。正确姿势是把 `ref` 指到修好的分支：
>
> ```bash
> gh workflow run release.yml --ref main -f tag=v0.4.0 -f ref=main -f only=desktop
> ```
>
> 重跑已成功的平台是安全的：tauri-action 上传前会先删掉同名旧资产，
> `softprops/action-gh-release` 同理，不会因为「资产已存在」而失败。

## 六、故障排查

### 发版前本地打包门禁（必须通过）

CI 每轮排队+构建要 20-30 分钟，能本地复现的问题先在本地跑一遍再推 tag：

```bash
pnpm build:pkg                                     # 完整 Web + tsc + 本机桌面打包
pnpm --filter @yuanchat/web exec tsc --noEmit        # 各 app 独立 typecheck（防幽灵依赖）
pnpm --filter @yuanchat/desktop exec tsc --noEmit
pnpm --filter @yuanchat/desktop exec tauri android build --apk --target aarch64
# 改动 Android 分发配置时，还要验证四个分包与通用包：
pnpm --filter @yuanchat/desktop exec tauri android build --apk --split-per-abi
pnpm --filter @yuanchat/desktop exec tauri android build --apk
```

**但要清楚它挡不住什么。** 本地预检验证的是「代码能编译、能打包」，验证不了
「干净机器上依赖装不装得上」—— 开发机早被历史操作装满了各种 `-dev` 包，
runner 是空的。v0.4.0 那轮就是本地全绿、CI 五个平台红了三个，三条全是环境差异
（缺 gstreamer `-dev`、runner 镜像的 libunwind 冲突、setup-android 的下架包）。
这类问题只能靠读 CI 日志定位，改 workflow 前先把工具语义查准，
别靠猜参数试错 —— 每猜错一轮就是 20 分钟，而且坏 commit 已经落在共享分支上。

### Android 打包报 `Permission xxx not found`

capabilities 里引用了移动端不存在的插件权限（如 `updater:default`、`process:default`
—— updater/process 在 `Cargo.toml` 中被 `cfg(not(android/ios))` 门控，Android 编译时
插件不存在，权限表里自然没有）。桌面专属权限必须放在带
`"platforms": ["macOS", "windows", "linux"]` 的独立 capability 文件
（`capabilities/desktop.json`），不能放平台无关的 `default.json`。

### Actions 里 Android 打包失败

- 检查 `ANDROID_KEYSTORE_BASE64` 是否完整（换行符可能导致 base64 解码失败，用 `base64 -w0` 生成）
- 检查 keystore 密码/别名 secrets 是否匹配 keystore 实际值
- 若失败在 `Setup Android SDK` 一步且报 `Failed to find package 'tools'`：
  `android-actions/setup-android` 的 `packages` 默认值含已被 Google 下架的旧版 `tools` 包，
  workflow 里已显式覆盖成 `platform-tools`

### Tauri Linux 依赖缺失

Actions 里已装：`libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev
librsvg2-dev libxdo-dev`，外加通话助手编译期要的
`libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev libgstreamer-plugins-bad1.0-dev`
和一个 `libunwind-dev`（装它之前要先 `apt-get purge 'libunwind-.*-dev'`，
runner 镜像预装的 LLVM 版本与它冲突）。本地开发另需运行期插件包，见
`docs/DEVELOPMENT.md`；两类包的区别与各自的报错长相见
[`docs/TROUBLESHOOTING.md` 的「发版 / CI 打包」节](TROUBLESHOOTING.md#发版--ci-打包)。

### macOS universal 包报某个二进制 does not exist

tauri 打 universal 包时只把**主程序** lipo 进 `target/universal-apple-darwin/release/`，
本仓的第二个 bin（通话助手）要在构建前自己补一次 lipo，workflow 里已有
`Pre-lipo call helper (macos)` 这一步。**不要**改用 `required-features` 去按平台关掉这个
bin —— tauri 判定 bin 启用只看 CLI 的 `-f` 参数、不看 cargo 的 default features，
一关就会转而按 `src/bin/` 的文件名找 `call_helper`，三个平台一起挂。详见上述排查文档。

### release-it 报 requireBranch 错

`.release-it.json` 要求在 `main` 分支运行。切分支：`git checkout main`

### 版本号已存在 tag 冲突

`git tag -d vX.Y.Z && git push origin :refs/tags/vX.Y.Z` 删除本地和远程 tag，然后重跑 release-it
