# 自托管部署指南

在一台干净的 Ubuntu 22.04+ / Debian 12+ 服务器上部署完整的元聊 YuanChat 服务。

## 一、前置条件

| 项目   | 要求                                                                           |
| ------ | ------------------------------------------------------------------------------ |
| 服务器 | 2 vCPU / 4 GB 内存 / 40 GB 磁盘起（含对象存储）                                |
| 系统   | Ubuntu 22.04+、Debian 12+（任何支持 Docker 的发行版均可）                      |
| Docker | 20.10+，含 compose v2 插件                                                     |
| 域名   | 5 个子域名，均已 A 记录解析到本机公网 IP                                       |
| 端口   | 80 / 443（证书签发与服务访问）、3478 TCP+UDP 与 49160-49200 UDP（coturn 中继） |

> **怎么挑机器和域名**（含国内外服务商价位对比、备案约束、按价格排序的推荐）
> 见 [server-and-domain.md](./server-and-domain.md)。

> **UDP 端口段别漏放行**：`49160-49200/udp` 是 coturn 的中继端口，云厂商安全组默认不开。
> 不放行的表现很有迷惑性 —— 登录、聊天、发图全正常，**只有跨 NAT 的语音/视频接通后没画面没声音**。

### 域名规划

| 子域名                    | 用途                                      |
| ------------------------- | ----------------------------------------- |
| `app.your-domain.com`     | Web 端                                    |
| `api.your-domain.com`     | REST API                                  |
| `ws.your-domain.com`      | WebSocket 长连                            |
| `admin.your-domain.com`   | 管理后台                                  |
| `storage.your-domain.com` | 对象存储（图片 / 语音 / 视频 / 头像下载） |

> 五个域名必须**先解析生效**再执行安装，否则 Let's Encrypt 的 HTTP-01 校验会失败。
> 验证：`dig +short app.your-domain.com` 应返回你的服务器 IP。

### 在域名注册商配置解析

各家注册商的控制台长得不一样，但要做的事完全相同：给五个子域各加一条 **A 记录**指向服务器公网 IP。

| Type | Hostname（主机记录） | 值            | TTL  |
| ---- | -------------------- | ------------- | ---- |
| A    | `app`                | 你的服务器 IP | 3600 |
| A    | `api`                | 你的服务器 IP | 3600 |
| A    | `ws`                 | 你的服务器 IP | 3600 |
| A    | `admin`              | 你的服务器 IP | 3600 |
| A    | `storage`            | 你的服务器 IP | 3600 |

入口位置的常见叫法：NameSilo 在 _Domain Manager → 域名 → DNS Records_，Cloudflare 在 _DNS → Records_，
阿里云/腾讯云在「云解析 DNS → 解析设置」，Namecheap 在 _Advanced DNS_。

与注册商无关的三个通用坑：

- **Hostname 只填前缀**。填 `app`，不要填 `app.your-domain.com` —— 绝大多数面板会自动补主域名，
  填全名会变成 `app.your-domain.com.your-domain.com`。少数面板（如 Cloudflare）要求填全名，
  以面板里已有记录的写法为准。
- **确认域名真的在用这家的 DNS**。很多注册商买来默认指向自己的 parking / 广告页 nameserver，
  此时在别处加 A 记录不生效；反过来，若你之前把 NS 改到了第三方（Cloudflare、DNSPod 等），
  就要去那一家加记录，在注册商面板里改没有任何效果。判断方法：`dig +short NS your-domain.com`
  返回哪家，就去哪家改。
- **等解析真正生效再执行安装**。Let's Encrypt 的 HTTP-01 校验要能从公网回连到你的 80 端口，
  解析没生效必然失败，而失败有每周配额（见下文「证书签发失败」）。生效时间从几分钟到半小时不等，
  用 `dig +short app.your-domain.com` 返回你的服务器 IP 才算好。

> 若要把域名托管在 Cloudflare，记得把这五条记录的代理开关设为 **DNS only（灰云）**。
> 开着橙云代理时 Cloudflare 会替你终止 TLS，本项目自己签的证书就不再被使用，
> 而 WebSocket 与对象存储直传都需要额外配置才能穿过代理。

### 放行端口

云厂商的安全组和机器上的 ufw 是两道独立的门，两边都要放行。机器侧：

```bash
# 先放 22 再 enable，顺序反了会把自己从 SSH 锁在门外
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3478/tcp && ufw allow 3478/udp
ufw allow 49160:49200/udp
ufw --force enable && ufw status numbered
```

### 独立数据盘与 swap

云主机常见「系统盘小 + 数据盘大」。Docker 默认把镜像、容器层、命名卷全写在
`/var/lib/docker`（系统盘），MinIO 的对象和 PostgreSQL 的数据都在命名卷里，
系统盘很快就满。**装 Docker 之前**先把 data-root 指到数据盘：

```bash
lsblk                       # 确认数据盘已挂载，例如 /dev/vdb1 → /www
grep /www /etc/fstab        # 没有这行就是没开机自动挂载，重启后数据「消失」

mkdir -p /etc/docker /www/docker
cat > /etc/docker/daemon.json <<'JSON'
{
  "data-root": "/www/docker",
  "log-driver": "json-file",
  "log-opts": { "max-size": "20m", "max-file": "3" }
}
JSON
```

`log-opts` 不加的话 JSON 日志无上限增长，长跑几个月能吃掉几十 GB。

内存 4 GB 左右的机器建议再加 swap —— 默认栈十个容器能跑得动，但前端镜像构建
（`pnpm install` + 两个 vite build）峰值会顶到内存上限被 OOM kill：

```bash
fallocate -l 4G /www/swapfile && chmod 600 /www/swapfile
mkswap /www/swapfile && swapon /www/swapfile
echo '/www/swapfile none swap sw 0 0' >> /etc/fstab
```

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

# 编辑域名、邮箱与 PUBLIC_IP（密码留空即可，脚本会自动生成随机值）
vim deploy/.env

# 再次运行：签发证书 → 构建镜像 → 启动全部服务
./deploy/install.sh
```

`deploy/.env` 里**必须手工填**的是五个域名、`ADMIN_EMAIL`，以及 `PUBLIC_IP`
（本机**外网** IP，`curl -s https://api.ipify.org` 可查）。`PUBLIC_IP` 没法由脚本自动探测 ——
NAT / 云主机里 `ip addr` 看到的是内网地址，填错等于没填：coturn 会把内网地址写进
relay candidate，跨 NAT 的通话就卡在「连接中」。留空时 `install.sh` 会直接报错退出。

其余凭据（含 `TURN_SECRET`）留空即可，脚本自动生成并写回 `.env`。

脚本按序完成：

1. 校验 docker / compose
2. 空密码字段自动生成随机强密码并写回 `.env`
3. `envsubst` 渲染 `nginx/nginx.conf` 与 `coturn/turnserver.prod.conf`
4. 临时自签证书让 nginx 起 443 → 走 HTTP-01 签发正式证书 → 每 12h 自动续期
5. `docker compose up -d --build`（首次构建约 5-10 分钟）

完成后访问 `https://app.your-domain.com`。

## 三、服务构成

| 容器                | 作用                           | 对外端口               |
| ------------------- | ------------------------------ | ---------------------- |
| `yuanchat-nginx`    | TLS 终止 + 五域名反代          | 80 / 443               |
| `yuanchat-server`   | Go 后端（REST 8085 / WS 8086） | 仅内网                 |
| `yuanchat-web`      | Web 端静态资源                 | 仅内网                 |
| `yuanchat-admin`    | 管理后台静态资源               | 仅内网                 |
| `yuanchat-postgres` | 数据库                         | 仅内网                 |
| `yuanchat-redis`    | 缓存 / presence Pub/Sub        | 仅内网                 |
| `yuanchat-minio`    | 对象存储（图片/文件/头像）     | 经 nginx               |
| `yuanchat-coturn`   | 通话 TURN/STUN 中继            | 3478 + 49160-49200/udp |
| `yuanchat-certbot`  | 证书自动续期                   | —                      |

数据库与 Redis **不映射宿主机端口**，只能经内网访问。
MinIO 同样不映射端口，但客户端要下载对象，故经 nginx 的 `storage` 子域反代对外。
coturn 是例外：UDP relay 没法走 nginx 反代，只能自己发布端口，需在安全组 / `ufw` 放行。

### 可观测（可选）

```bash
./deploy/yuanchat.sh monitor on
# 等价于 docker compose -f deploy/docker-compose.prod.yml --profile observability up -d
```

启用 Prometheus + Grafana + Loki。三者都在 `observability` profile 后面，**默认不启动** ——
平时不看监控就不必白占内存（Grafana + Prometheus 大约 200-300 MB）。

Prometheus 与 Grafana 的端口**只绑在宿主机回环**（`127.0.0.1:9090` / `127.0.0.1:3000`），
公网扫不到，访问要走 SSH 隧道：

```bash
# 在你自己的机器上执行；本地端口可随意改，冒号右边必须是 3000 / 9090
ssh -fN -L 3300:localhost:3000 -L 9099:localhost:9090 user@your-server
# 然后浏览器打开 http://localhost:3300
```

Grafana 账号是 `admin`，密码为 `deploy/.env` 里的 `GRAFANA_PASSWORD`（`install.sh` 随机生成）。
Prometheus 的 Web UI 在 `http://localhost:9099`，数据源已自动置备，不需要手工加。

两个容易卡住的点：

- **本地端口被占时整条 ssh 命令失败**，而不是只跳过那一个转发。`3000` 这种常用端口很可能已被
  本机的某个 dev server 占着，表现为隧道建不起来；换一个本地端口即可（上例用了 3300 / 9099）。
- **别用 `pkill -f "ssh -fN -L ..."` 清理旧隧道**。`pkill -f` 匹配完整命令行，会连执行这条命令的
  shell 自己一起杀掉（它的命令行里也含有该字符串），结果是隧道和你的终端一起没了。
  改用 `ss -ltn | grep 127.0.0.1:3300` 先判断是否已有隧道。

Loki 不单独开端口，日志在 Grafana 里通过 Loki 数据源查。

## 四、日常运维

`deploy/yuanchat.sh` 是统一入口，封装了下面这些 compose 命令：

```bash
./deploy/yuanchat.sh deploy        # 首次部署（= install.sh）
./deploy/yuanchat.sh start|stop    # 启停全栈，stop 保留数据卷
./deploy/yuanchat.sh restart
./deploy/yuanchat.sh status        # 容器状态 + 磁盘 + 内存
./deploy/yuanchat.sh logs [服务]   # 跟随日志，省略服务名看全栈
./deploy/yuanchat.sh update        # 拉代码 → 对齐 APP_VERSION → 重建滚动重启
./deploy/yuanchat.sh monitor on    # 按需开可观测栈
./deploy/yuanchat.sh backup
```

脚本不提供删卷入口。要清库得手工 `docker compose -f deploy/docker-compose.prod.yml down -v`，
那会连 PostgreSQL 与 MinIO 的数据一起删。

直接用 compose 也可以：

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
./deploy/yuanchat.sh update
```

等价于 `git pull` + `docker compose -f deploy/docker-compose.prod.yml up -d --build`，
但多做一步：把 `.env` 的 `APP_VERSION` 对齐到根 `package.json` 的 version。
compose 的镜像 tag 是 `yuanchat/server:${APP_VERSION}`，两者脱节时 compose 会去找一个
从没构建过的 tag，表现为「更新完还是跑旧代码」。

> **前端域名是编译期注入的**：`VITE_API_BASE_URL` / `VITE_WS_URL` 在 `docker build` 阶段
> 就被 vite 打进包里。改了 `.env` 里任一域名后，只重启不够，必须 `--build` 重建
> `yuanchat-web` 与 `yuanchat-admin`，否则前端还在请求旧域名。

`migrate` 容器会在 `yuanchat-server` 启动前自动跑完 goose 迁移；迁移失败则 server 不会启动（`service_completed_successfully` 依赖）。

### 管理员账号

**管理后台没有注册入口**，因此第一个管理员必须在部署时引导出来 —— 否则装完谁都登不进
`admin` 子域。在 `deploy/.env` 里填好手机号即可，密码留空由 `install.sh` 随机生成：

```bash
ADMIN_PHONE=13800138000     # 管理后台的登录账号，必须自己填
ADMIN_PASSWORD=             # 留空则自动生成并写回 .env
```

`install.sh` 会在服务起好后跑一次 `/app/bootstrap-admin`，建号并打印登录信息。
这一步**幂等**：库里已存在任一管理员时直接跳过，**不会**把线上密码重置回 `.env` 里的值 ——
否则每次重跑 `install.sh` 都等于给管理员留一把永久后门（`.env` 常年躺在服务器上）。

手机号已被占用时（常见于先在 Web 端注册了再跑脚本）会**提权该账号而非新建**，密码保持原样 ——
不这么做会撞 `phone` 唯一索引直接失败。

首次登录后请做两件事：

1. 在应用内改密（改密递增 `token_version`，旧令牌立即失效）
2. 清空 `.env` 里的 `ADMIN_PASSWORD`

漏填 `ADMIN_PHONE` 时脚本会告警跳过。补救方式是先在 Web 端注册一个账号，再手工提权：

```bash
COMPOSE="docker compose -f deploy/docker-compose.prod.yml"
$COMPOSE exec postgres psql -U yuanchat -d yuanchat \
  -c "UPDATE users SET role = 1 WHERE phone = '你的手机号';"
```

填好 `ADMIN_PHONE` 后重跑 `./deploy/install.sh` 也可以，脚本会补上这一步。

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

### MinIO 镜像拉不下来（pull access denied）

```
Error response from daemon: pull access denied for minio/minio,
repository does not exist or may require 'docker login'
```

**不是打错 tag，也不是限流。** 2026-10 实测：`minio/minio` 在 Docker Hub 上整个仓库都
取不到，连 `:latest` 都是同一个报错；官方备用的 `quay.io/minio/minio` 返回 `401 UNAUTHORIZED`。
MinIO 把社区镜像收到认证后面了，匿名 docker pull 这条路断了。

这个报错有迷惑性：Docker 对「tag 不存在」和「无权访问」返回同一句话，很容易以为是
compose 里的版本号写错了，于是去改 tag —— 改成什么都一样失败。

绕过办法按推荐顺序：

1. **从一台已有该镜像的机器直传**（本项目用的就是这招，不需要任何账号）：

   ```bash
   docker save minio/minio:RELEASE.2025-04-22T22-12-26Z \
     | gzip -1 | ssh root@<服务器> 'gunzip | docker load'
   ```

   `docker save` 报 `reference does not exist` 说明本机并没有这个 tag ——
   先 `docker images --format '{{.Repository}}:{{.Tag}}'` 看清楚本机到底有哪个版本，
   别照着 `docker ps` 里显示的镜像名去 save（容器记的是带 digest 的引用，
   本地未必存在同名 tag）。

2. 在 MinIO 官方注册处拿到凭据后 `docker login`，再按原 tag 拉。
3. 退而求其次：换一个仍可匿名拉取的 S3 兼容实现（会改 env 语义与初始化方式，
   `MINIO_SERVER_URL` / `MINIO_ROOT_*` 这些都要重新对照，不建议临时换）。

**不要把 compose 里的版本号改成 `latest` 来试**，那既违反版本钉死的约定，
也解决不了权限问题。

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

下发给客户端的 URL 用的是**对外**地址 `DOMAIN_STORAGE`，与服务端建连用的内网
`minio:9000` 是两个不同的配置项。预签名 URL 的 SigV4 签名把 Host 头也算进签名，
所以下面三处必须是同一个域名，任一处不一致都会得到 403 签名校验失败（不会静默降级）：

1. 后端 `YUANCHAT_MINIO_PUBLIC_ENDPOINT`
2. MinIO 容器的 `MINIO_SERVER_URL`
3. nginx `storage` 子域的 `server_name`（该 location 须 `proxy_set_header Host $host`）

用默认的 `docker-compose.prod.yml` 时三处都由 `.env` 的 `DOMAIN_STORAGE` 推导，天然一致。
排查步骤：

```bash
dig +short storage.your-domain.com          # 是否解析到本机
$COMPOSE exec nginx ls /etc/letsencrypt/live/  # storage 子域证书是否已签发
grep -n 'DOMAIN_STORAGE' deploy/.env           # 是否仍是 example.com 示例值
```

若客户端报的 URL host 是 `minio:9000`，说明 `YUANCHAT_MINIO_PUBLIC_ENDPOINT` 没生效
（回落到了内网建连地址），检查该环境变量是否真的传进了容器：
`$COMPOSE exec yuanchat-server env | grep MINIO`。

### 桌面端加载不出图片（Tauri CSP）

桌面端的 CSP 白名单只列真实可达的主机，不用 `https:` 通配放行。自建部署后需要把你的
存储域名加进 `apps/desktop/src-tauri/tauri.conf.json` 的 `app.security.csp`，
在 `img-src`、`media-src`、`connect-src` 三处各加上 `https://storage.your-domain.com`，
然后重新构建桌面包。不改的话图片与语音会被 CSP 拦掉（控制台报 CSP 违规，网络面板无请求）。

### 后端起不来

```bash
$COMPOSE logs migrate          # 先看迁移是否失败
$COMPOSE logs yuanchat-server  # JSON 日志，含 req_id 便于串联
```

### 通话接不通 / 一直「连接中」

两端都在 NAT 后面时媒体要靠 coturn 中继，中继链路断在哪一环按序排查：

```bash
# 1. 服务端是否真下发了 TURN 项（只有 stun: 一项 = 密钥没传进容器）
$COMPOSE exec yuanchat-server env | grep YUANCHAT_TURN

# 2. coturn 拿到的密钥与 realm 必须与上一步完全一致
grep -E '^(static-auth-secret|realm|external-ip)=' deploy/coturn/turnserver.prod.conf

# 3. external-ip 必须是外网 IP，不是 172.x / 10.x 之类的内网地址
curl -s https://api.ipify.org    # 与上面 external-ip 对比

# 4. 端口是否放行
$COMPOSE logs yuanchat-coturn | tail -20
```

对照要点：

- `YUANCHAT_TURN_STATIC_AUTH_SECRET` 与 conf 的 `static-auth-secret` 不同值 → 全部通话认证失败
- `YUANCHAT_TURN_REALM` 与 conf 的 `realm` 不同值 → 同样全挂
- `YUANCHAT_TURN_HOST` 填成容器内网名（如 `coturn`）→ 浏览器解析不了
- `external-ip` 是内网地址 → 客户端拿到连不上的 relay candidate，表现就是一直「连接中」
- 3478 或 49160-49200/udp 被安全组挡住 → 同上

用默认的 `docker-compose.prod.yml` 时，前三项都由 `.env` 的 `TURN_SECRET` 与 `DOMAIN_APP`
推导（compose 与 coturn 配置读的是同一组变量），天然一致；改过其中一边才会出现不匹配。
`deploy/coturn/turnserver.prod.conf` 是 `install.sh` 渲染的产物，不要手改 ——
下次运行会被覆盖，要改请改 `turnserver.prod.conf.template`。

## 七、环境变量

全部可配置项见 [`env.md`](./env.md)。
