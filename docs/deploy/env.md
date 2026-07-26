# 环境变量参考

后端配置读取优先级：**环境变量 > `config/config.yaml`**。
环境变量命名规则：`YUANCHAT_` + 配置路径大写、`.` 换 `_`。
例如 `database.host` → `YUANCHAT_DATABASE_HOST`。

## 一、后端（Go）

### 服务

| 变量                      | 默认值        | 说明                                                                                              |
| ------------------------- | ------------- | ------------------------------------------------------------------------------------------------- |
| `YUANCHAT_SERVER_ENV`     | `development` | `development` / `staging` / `production`；production 下 gin 走 release 模式且 WS 校验 Origin 同源 |
| `YUANCHAT_SERVER_PORT`    | `8085`        | REST 端口                                                                                         |
| `YUANCHAT_WEBSOCKET_PORT` | `8086`        | WebSocket 端口（独立监听）                                                                        |

### 数据库

| 变量                         | 默认值      | 说明                        |
| ---------------------------- | ----------- | --------------------------- |
| `YUANCHAT_DATABASE_HOST`     | `localhost` | PostgreSQL 主机             |
| `YUANCHAT_DATABASE_PORT`     | `5434`      | 端口（开发用 compose 映射） |
| `YUANCHAT_DATABASE_USER`     | `yuanchat`  | 用户名                      |
| `YUANCHAT_DATABASE_PASSWORD` | —           | **生产必填**                |
| `YUANCHAT_DATABASE_DBNAME`   | `yuanchat`  | 库名                        |

### Redis

| 变量                      | 默认值      | 说明                        |
| ------------------------- | ----------- | --------------------------- |
| `YUANCHAT_REDIS_HOST`     | `localhost` | 主机                        |
| `YUANCHAT_REDIS_PORT`     | `6380`      | 端口（开发用 compose 映射） |
| `YUANCHAT_REDIS_PASSWORD` | 空          | 生产建议设置                |

### 认证

| 变量                  | 默认值 | 说明                                                              |
| --------------------- | ------ | ----------------------------------------------------------------- |
| `YUANCHAT_JWT_SECRET` | —      | **生产必填**，建议 48 位以上随机串；更换会使全部已签发 token 失效 |

### 对象存储（MinIO / S3）

| 变量                        | 默认值           | 说明                     |
| --------------------------- | ---------------- | ------------------------ |
| `YUANCHAT_MINIO_ENDPOINT`   | `localhost:9002` | 服务地址（不含 scheme）  |
| `YUANCHAT_MINIO_ACCESS_KEY` | —                | 访问密钥                 |
| `YUANCHAT_MINIO_SECRET_KEY` | —                | 私有密钥                 |
| `YUANCHAT_MINIO_BUCKET`     | `yuanchat`       | 桶名（首次连接自动创建） |
| `YUANCHAT_MINIO_USE_SSL`    | `false`          | 生产走 HTTPS 时设 `true` |

> 预签名 URL 里的 host 来自 `endpoint`。真机/公网访问时必须填**客户端可达**的地址，
> 填 `localhost` 会导致客户端连自己而非服务器。

### 日志

| 变量                     | 默认值            | 说明                                 |
| ------------------------ | ----------------- | ------------------------------------ |
| `YUANCHAT_LOG_LEVEL`     | `debug`           | `debug` / `info` / `warn` / `error`  |
| `YUANCHAT_LOG_FORMAT`    | `console`         | 生产用 `json`（Loki 采集需要）       |
| `YUANCHAT_LOG_OUTPUT`    | `stdout`          | `stdout` / `file`；容器化用 `stdout` |
| `YUANCHAT_LOG_FILE_PATH` | `logs/server.log` | `output=file` 时的路径               |

日志字段规范见 [`../observability/logging.md`](../observability/logging.md)。

### 在线状态（Presence）

| 变量                        | 默认值            | 说明                                                    |
| --------------------------- | ----------------- | ------------------------------------------------------- |
| `YUANCHAT_PRESENCE_BACKEND` | `local`           | `local`=单实例进程内；`redis`=多实例 Pub/Sub 跨实例同步 |
| `YUANCHAT_PRESENCE_CHANNEL` | `presence:events` | redis 模式的事件 channel                                |

> 多副本部署**必须**设为 `redis`，否则 A 实例的用户在 B 实例上被判为离线。

### Web Push

| 变量                              | 默认值  | 说明                                     |
| --------------------------------- | ------- | ---------------------------------------- |
| `YUANCHAT_PUSH_VAPID_PUBLIC_KEY`  | 空      | 留空则推送功能整体关闭（仅 WS 实时投递） |
| `YUANCHAT_PUSH_VAPID_PRIVATE_KEY` | 空      | 同上；两者需成对配置                     |
| `YUANCHAT_PUSH_SUBJECT`           | —       | `mailto:` 或站点 URL（VAPID 规范要求）   |
| `YUANCHAT_PUSH_TTL`               | `86400` | 推送服务保留秒数                         |

生成密钥对：`cd server && go run ./cmd/genvapid`

### 内容审核

| 变量               | 默认值  | 说明                                                                                |
| ------------------ | ------- | ----------------------------------------------------------------------------------- |
| `moderation.words` | 见 yaml | 敏感词库（数组，仅支持 yaml 配置）；命中的消息标记 `flagged` 进审核队列，不阻塞发送 |

## 二、前端（Vite，构建期注入）

前端变量在**构建时**编译进产物，运行期无法更改；改地址需重新构建。

| 变量                | 说明                                            |
| ------------------- | ----------------------------------------------- |
| `VITE_API_BASE_URL` | REST API 地址，如 `https://api.your-domain.com` |
| `VITE_WS_URL`       | WebSocket 地址，如 `wss://ws.your-domain.com`   |
| `VITE_ENABLE_MOCK`  | `false` 关闭 MSW（生产必须关闭）                |
| `VITE_SENTRY_DSN`   | Sentry DSN（可选，留空则不上报）                |

生产部署由 `docker-compose.prod.yml` 的 build args 从 `.env` 的域名自动推导，无需手动设置。

## 三、部署编排（deploy/.env）

供 `docker-compose.prod.yml` 与 `install.sh` 使用，见 [`deploy/.env.prod.example`](../../deploy/.env.prod.example)。

| 变量                                                        | 说明                               |
| ----------------------------------------------------------- | ---------------------------------- |
| `DOMAIN_APP` / `DOMAIN_API` / `DOMAIN_WS` / `DOMAIN_ADMIN`  | 四个子域名，须已解析到本机         |
| `ADMIN_EMAIL`                                               | Let's Encrypt 到期通知邮箱         |
| `DB_PASSWORD` / `REDIS_PASSWORD` / `JWT_SECRET` / `MINIO_*` | 留空则 `install.sh` 自动生成随机值 |
| `PRESENCE_BACKEND`                                          | 多实例部署改 `redis`               |
| `APP_VERSION`                                               | 镜像 tag，默认 `latest`            |
| `TZ`                                                        | 容器时区，默认 `Asia/Shanghai`     |

> `deploy/.env` 含明文凭据，已被 `.gitignore` 排除，**切勿提交**。
