# 发版指南

本文档说明 YuanChat 应用发版流程 —— 从 tag 到多平台安装包。

## 一、一次性准备（首次发版前）

### 1. GitHub Secrets 配置

在 `https://github.com/liaojie1314/yuanchat/settings/secrets/actions` 添加以下 Secrets（**只在首次配置一次**）：

| Secret 名                   | 值                      | 说明                                      |
| --------------------------- | ----------------------- | ----------------------------------------- |
| `ANDROID_KEYSTORE_BASE64`   | 见下方"获取 base64"步骤 | Android release keystore 的 base64 编码   |
| `ANDROID_KEYSTORE_PASSWORD` | `yuanchat_release_2026` | keystore 密码（**发版后请改为你自己的**） |
| `ANDROID_KEY_ALIAS`         | `yuanchat`              | 密钥别名                                  |
| `ANDROID_KEY_PASSWORD`      | `yuanchat_release_2026` | 密钥密码                                  |

**不需要**：

- `GITHUB_TOKEN` —— Actions 自动提供
- macOS/Windows 代码签名 secrets —— 本轮先跳过，未来买证书时再补：
  - `APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_SIGNING_IDENTITY`
  - `APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID`（notarize 用）
  - `WINDOWS_CERTIFICATE`、`WINDOWS_CERTIFICATE_PASSWORD`

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

### Step 1：确保 dev 已合并到 main

```bash
git checkout main
git pull
git merge --no-ff dev -m "chore: sync dev for release"
git push origin main
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

| 平台            | Runner         | 产物                                      |
| --------------- | -------------- | ----------------------------------------- |
| Web             | ubuntu-latest  | `yuanchat-web-vX.Y.Z.tar.gz`（Vite dist） |
| Linux Desktop   | ubuntu-latest  | `.deb` + `.AppImage`                      |
| Windows Desktop | windows-latest | `.msi` + `.exe`                           |
| macOS Desktop   | macos-latest   | `.dmg`（x64 + aarch64）                   |
| Android         | ubuntu-latest  | `yuanchat-vX.Y.Z.apk`（signed）           |

产物自动 attach 到对应的 GitHub Release。全程约 20-30 分钟。

### Step 4：发布 Release

到 `https://github.com/liaojie1314/yuanchat/releases` 找到刚创建的 Release：

- 检查所有产物都已上传
- 编辑 Release notes（release-it 已按 CHANGELOG 生成）
- 点 "Publish release"

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
- Windows `.msi`：双击安装（未签名会有 SmartScreen 警告，点"仍要运行"）
- macOS `.dmg`：拖到 Applications（未签名会有 Gatekeeper 警告，右键"打开"或系统偏好设置 → 安全性放行）

### Android APK

- 用浏览器/文件管理器安装（首次需在设置里开启"未知来源"）
- 未签名 = 不能上架 Google Play。上架 Play 需另外配置 Google Play Console upload key

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

## 五、故障排查

### Actions 里 Android 打包失败

- 检查 `ANDROID_KEYSTORE_BASE64` 是否完整（换行符可能导致 base64 解码失败，用 `base64 -w0` 生成）
- 检查 keystore 密码/别名 secrets 是否匹配 keystore 实际值

### Tauri Linux 依赖缺失

Actions 里已装：`libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev`。本地开发额外需要，见 `docs/DEVELOPMENT.md`。

### release-it 报 requireBranch 错

`.release-it.json` 要求在 `main` 分支运行。切分支：`git checkout main`

### 版本号已存在 tag 冲突

`git tag -d vX.Y.Z && git push origin :refs/tags/vX.Y.Z` 删除本地和远程 tag，然后重跑 release-it
