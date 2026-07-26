# 自托管部署指南

在一台干净的 Ubuntu 22.04+ / Debian 12+ 服务器上部署完整的元聊 YuanChat 服务。

## 一、前置条件

| 项目   | 要求                                                      |
| ------ | --------------------------------------------------------- |
| 服务器 | 2 vCPU / 4 GB 内存 / 40 GB 磁盘起（含对象存储）           |
| 系统   | Ubuntu 22.04+、Debian 12+（任何支持 Docker 的发行版均可） |
| Docker | 20.10+，含 compose v2 插件                                |
| 域名   | 4 个子域名，均已 A 记录解析到本机公网 IP                  |
| 端口   | 80 / 443 对公网开放（证书签发与服务访问）                 |

### 域名规划

| 子域名                  | 用途           |
| ----------------------- | -------------- |
| `app.your-domain.com`   | Web 端         |
| `api.your-domain.com`   | REST API       |
| `ws.your-domain.com`    | WebSocket 长连 |
| `admin.your-domain.com` | 管理后台       |

> 四个域名必须**先解析生效**再执行安装，否则 Let's Encrypt 的 HTTP-01 校验会失败。
> 验证：`dig +short app.your-domain.com` 应返回你的服务器 IP。

### 安装 Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER" && newgrp docker
```

## 二、部署

```bash
git clone https://github.com/liaojie1314/yuanchat.git
cd yuanchat

# 首次运行会生成 deploy/.env 并退出，提示你填写域名
./deploy/install.sh

# 编辑域名与邮箱（密码留空即可，脚本会自动生成随机值）
vim deploy/.env

# 再次运行：签发证书 → 构建镜像 → 启动全部服务
./deploy/install.sh
```

脚本按序完成：

1. 校验 docker / compose
2. 空密码字段自动生成随机强密码并写回 `.env`
3. `envsubst` 渲染 `nginx/nginx.conf`
4. 临时自签证书让 nginx 起 443 → 走 HTTP-01 签发正式证书 → 每 12h 自动续期
5. `docker compose up -d --build`（首次构建约 5-10 分钟）

完成后访问 `https://app.your-domain.com`。

## 三、服务构成

| 容器                | 作用                           | 对外端口 |
| ------------------- | ------------------------------ | -------- |
| `yuanchat-nginx`    | TLS 终止 + 四域名反代          | 80 / 443 |
| `yuanchat-server`   | Go 后端（REST 8085 / WS 8086） | 仅内网   |
| `yuanchat-web`      | Web 端静态资源                 | 仅内网   |
| `yuanchat-admin`    | 管理后台静态资源               | 仅内网   |
| `yuanchat-postgres` | 数据库                         | 仅内网   |
| `yuanchat-redis`    | 缓存 / presence Pub/Sub        | 仅内网   |
| `yuanchat-minio`    | 对象存储（图片/文件/头像）     | 仅内网   |
| `yuanchat-certbot`  | 证书自动续期                   | —        |

数据库、Redis、MinIO **不映射宿主机端口**，只能经内网访问。

### 可观测（可选）

```bash
docker compose -f deploy/docker-compose.prod.yml --profile observability up -d
```

启用 Prometheus + Grafana + Loki。默认不对外暴露，需要访问时通过 SSH 隧道：

```bash
ssh -L 3000:localhost:3000 user@your-server   # 然后本机访问 localhost:3000
```

## 四、日常运维

```bash
cd /path/to/yuanchat/deploy
COMPOSE="docker compose -f docker-compose.prod.yml"

$COMPOSE ps                        # 服务状态
$COMPOSE logs -f yuanchat-server   # 跟踪后端日志（JSON 一行一条）
$COMPOSE restart yuanchat-server   # 重启后端
$COMPOSE down                      # 停止全部（数据卷保留）
```

### 更新到新版本

```bash
git pull
docker compose -f deploy/docker-compose.prod.yml up -d --build
```

`migrate` 容器会在 `yuanchat-server` 启动前自动跑完 goose 迁移；迁移失败则 server 不会启动（`service_completed_successfully` 依赖）。

### 创建管理员账号

首次部署后数据库无管理员，需手动提升：

```bash
COMPOSE="docker compose -f deploy/docker-compose.prod.yml"
# 先在 Web 端正常注册一个账号，然后：
$COMPOSE exec postgres psql -U yuanchat -d yuanchat \
  -c "UPDATE users SET role = 1 WHERE phone = '你的手机号';"
```

之后用该账号登录 `https://admin.your-domain.com`。

## 五、备份

```bash
./deploy/backup.sh          # 手动执行一次
```

产出 `deploy/backups/pg-<时间戳>.sql.gz` 与 `minio-<时间戳>.tar.gz`，默认保留最近 7 份。

### 定时备份

```bash
crontab -e
# 每日 03:00
0 3 * * * /path/to/yuanchat/deploy/backup.sh >> /var/log/yuanchat-backup.log 2>&1
```

> **异地副本**：`deploy/backups/` 与服务在同一磁盘，磁盘损坏会一起丢。
> 生产环境请再加一步同步到对象存储或另一台机器，例如
> `rclone sync deploy/backups remote:yuanchat-backups`。

### 灾难恢复

```bash
COMPOSE="docker compose -f deploy/docker-compose.prod.yml"

# 1. 恢复数据库
gunzip -c deploy/backups/pg-<时间戳>.sql.gz | \
  $COMPOSE exec -T postgres psql -U yuanchat -d yuanchat

# 2. 恢复对象存储
$COMPOSE stop minio
docker run --rm -v yuanchat_minio_data:/data \
  -v "$PWD/deploy/backups":/backup \
  alpine sh -c "rm -rf /data/* && tar xzf /backup/minio-<时间戳>.tar.gz -C /data"
$COMPOSE start minio
```

## 六、故障排查

### 证书签发失败

```
错误: 证书签发失败：确认 xxx 已解析到本机公网 IP 且 80 端口可达
```

依次检查：

1. `dig +short <域名>` 是否返回本机公网 IP
2. 云厂商安全组 / `ufw` 是否放行 80、443
3. 80 端口是否被其他进程占用：`sudo ss -tlnp | grep :80`
4. Let's Encrypt 有速率限制（同域名每周 5 次失败上限），频繁重试需等待

### WebSocket 连不上

- 确认 `ws.your-domain.com` 证书已签发：`$COMPOSE exec nginx ls /etc/letsencrypt/live/`
- 前置 CDN（如 Cloudflare）需开启 WebSocket 支持
- nginx 的 `proxy_read_timeout` 已设 660s 以容纳客户端最长 300s 的后台心跳；若中间还有其他代理，需同步放宽

### 图片上传失败 / 预签名 URL 打不开

MinIO 的 `MINIO_SERVER_URL` 决定预签名 URL 的 host，必须是客户端可达的公网地址。
默认走 `https://${DOMAIN_API}/s3`，如果你改了架构，需同步调整
`docker-compose.prod.yml` 的 `MINIO_SERVER_URL` 与 nginx 转发规则。

### 后端起不来

```bash
$COMPOSE logs migrate          # 先看迁移是否失败
$COMPOSE logs yuanchat-server  # JSON 日志，含 req_id 便于串联
```

## 七、环境变量

全部可配置项见 [`env.md`](./env.md)。
