# CLAUDE.md — YuanChat 项目 AI 上下文

## 项目简述

元聊 (YuanChat) — 企业级即时通讯软件。从零开始构建，不依赖现有 IM 开源项目。

## 技术决策记录

### 前端
- **状态管理**：Zustand（轻量、TypeScript 友好、无样板代码）
- **样式方案**：Tailwind CSS（快速开发、可定制设计系统）
- **组件库**：无第三方 UI 库，全部自建组件（确保设计独立性）
- **路由**：React Router v7
- **国际化**：react-i18next
- **实时通信**：自定义 WebSocket Hook + 消息队列

### 后端
- **HTTP 框架**：Gin（性能好、社区活跃）
- **WebSocket**：gorilla/websocket
- **gRPC**：官方 google.golang.org/grpc
- **ORM**：GORM v2
- **配置管理**：Viper
- **日志**：Zap (uber-go/zap)
- **依赖注入**：Wire (google/wire)

### 数据库
- **主存储**：PostgreSQL 16
- **缓存**：Redis 7
- **文件存储**：MinIO (S3 兼容)
- **搜索引擎**：Elasticsearch 8

## 代码风格约定

### Go
- 遵循 Effective Go
- 使用 `gofmt` 和 `goimports`
- 错误处理使用 `errors.Is` / `errors.As` 模式
- 包名简洁、小写、无下划线
- 接口命名以 `-er` 结尾

### TypeScript
- 严格模式 (`strict: true`)
- 函数组件 + Hooks（不使用 Class 组件）
- 类型优先使用 `interface`，联合类型用 `type`
- 文件命名：组件用 PascalCase，工具函数用 camelCase
- 每个文件尽量控制在 300 行以内

## Git 分支命名

```
feature/<功能简述>     e.g. feature/user-auth
bugfix/<问题简述>     e.g. bugfix/ws-reconnect
release/<版本号>      e.g. release/v1.0.0
hotfix/<问题简述>     e.g. hotfix/v1.0.1-session-fix
```

## 环境变量约定

```
# 后端
SERVER_ENV=development|staging|production
DB_HOST=localhost
DB_PORT=5432
DB_USER=yuanchat
DB_PASSWORD=<secret>
DB_NAME=yuanchat
REDIS_ADDR=localhost:6379
JWT_SECRET=<secret>
MINIO_ENDPOINT=localhost:9000
MINIO_ACCESS_KEY=<key>
MINIO_SECRET_KEY=<secret>

# 前端
VITE_API_BASE_URL=http://localhost:8080
VITE_WS_URL=ws://localhost:8081
```
