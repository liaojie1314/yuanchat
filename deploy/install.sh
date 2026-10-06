#!/usr/bin/env bash
#
# 元聊 YuanChat 一键部署（干净 Ubuntu 22.04+ / Debian 12+）
#
#   ./deploy/install.sh
#
# 做的事：
#   1. 校验 docker / docker compose
#   2. 从 .env.prod.example 生成 .env（缺失的密码自动随机生成）
#   3. envsubst 渲染 nginx.conf 与 coturn/turnserver.prod.conf
#   4. 首次签发 Let's Encrypt 证书（HTTP-01）
#   5. docker compose up -d 并等待健康
#
# 幂等：可重复执行；已存在的 .env 与证书不会被覆盖。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[0;33m'; NC=$'\033[0m'
info()  { echo "${GREEN}==>${NC} $*"; }
warn()  { echo "${YELLOW}警告:${NC} $*"; }
die()   { echo "${RED}错误:${NC} $*" >&2; exit 1; }

# ---------- 1. 前置检查 ----------
command -v docker >/dev/null 2>&1 || die "未安装 docker，请先安装：curl -fsSL https://get.docker.com | sh"
docker compose version >/dev/null 2>&1 || die "docker compose v2 不可用（需 Docker 20.10+）"
command -v openssl >/dev/null 2>&1 || die "缺少 openssl（用于生成随机密码）"

# ---------- 2. 生成 .env ----------
# 支持两种用法：
#   1) 直接跑 → 生成 .env 后退出，让用户填域名，再跑第二次
#   2) 预先用环境变量喂进来 → 一条命令装完，不需要中途编辑文件：
#        DOMAIN_APP=chat.x.com DOMAIN_API=api.x.com ... ./deploy/install.sh
# 第二种是「真一键」的关键：CI / 重装脚本里没法交互式编辑文件。
REQUIRED_VARS="DOMAIN_APP DOMAIN_API DOMAIN_WS DOMAIN_ADMIN DOMAIN_STORAGE ADMIN_EMAIL"

if [ ! -f .env ]; then
  info "创建 .env（从 .env.prod.example）"
  cp .env.prod.example .env

  # 环境变量里已给的值直接写进去，省掉一轮手工编辑
  filled=0
  for var in $REQUIRED_VARS ADMIN_PHONE PUBLIC_IP; do
    value="$(eval "printf '%s' \"\${$var:-}\"")"
    if [ -n "$value" ]; then
      if grep -q "^${var}=" .env; then
        sed -i "s|^${var}=.*|${var}=${value}|" .env
      else
        printf '%s=%s\n' "$var" "$value" >> .env
      fi
      filled=$((filled + 1))
    fi
  done
  [ "$filled" -gt 0 ] && info "已从环境变量写入 $filled 项"

  # 必填项仍有缺口才停下来要人工介入
  missing=""
  for var in $REQUIRED_VARS; do
    value="$(grep "^${var}=" .env | head -1 | cut -d= -f2-)"
    case "$value" in
      ""|*example.com) missing="$missing $var" ;;
    esac
  done
  if [ -n "$missing" ]; then
    warn "请编辑 deploy/.env 填写:$missing"
    warn "填好后重新运行本脚本；或下次直接用环境变量一条命令装完"
    exit 0
  fi
fi

# shellcheck disable=SC1091
set -a; source .env; set +a

for var in DOMAIN_APP DOMAIN_API DOMAIN_WS DOMAIN_ADMIN DOMAIN_STORAGE ADMIN_EMAIL; do
  value="${!var:-}"
  [ -n "$value" ] || die ".env 缺少 $var"
  case "$value" in
    *example.com) die "$var 仍是示例值（$value），请改为你的真实域名" ;;
  esac
done

# PUBLIC_IP 留空时自动探测。注意**不能**用 `ip addr` —— NAT / 云主机里看到的是内网地址，
# 填错不会报错，只会让 coturn 把不可达地址写进 relay candidate，表现为通话永远「连接中」。
# 走外部回显服务拿到的才是真正的出口 IP。探测不到就停下来要人工填，不猜。
if [ -z "${PUBLIC_IP:-}" ]; then
  info "探测本机公网 IP"
  detected="$(curl -fsS -m 10 https://api.ipify.org 2>/dev/null \
    || curl -fsS -m 10 https://ifconfig.me/ip 2>/dev/null || true)"
  case "$detected" in
    *[0-9].[0-9]*)
      if grep -q '^PUBLIC_IP=' .env; then
        sed -i "s|^PUBLIC_IP=.*|PUBLIC_IP=${detected}|" .env
      else
        printf 'PUBLIC_IP=%s\n' "$detected" >> .env
      fi
      export PUBLIC_IP="$detected"
      info "探测到公网 IP: ${detected}（如有误请改 deploy/.env 后重跑）"
      ;;
    *)
      die "无法自动探测公网 IP，请手工填写 deploy/.env 的 PUBLIC_IP
       查看方式：curl -s https://api.ipify.org  或云控制台的公网 IP
       注意不是 ip addr 看到的内网地址"
      ;;
  esac
fi

# 空密码自动生成随机值并写回 .env
gen_secret() {
  local key="$1" len="${2:-32}"
  local current="${!key:-}"
  if [ -z "$current" ]; then
    local value
    value="$(openssl rand -base64 48 | tr -d '/+=' | head -c "$len")"
    if grep -q "^${key}=" .env; then
      # 仅替换空值行，保留用户已填内容
      sed -i "s|^${key}=$|${key}=${value}|" .env
    else
      # 老部署的 .env 可能没有新增的键；不补进去的话下次单独跑
      # docker compose 会取到空值（compose 只读 .env 文件，读不到本脚本的 export）
      printf '%s=%s\n' "$key" "$value" >> .env
    fi
    export "${key}=${value}"
    info "已生成随机 ${key}"
  fi
}
gen_secret DB_PASSWORD 32
gen_secret REDIS_PASSWORD 32
gen_secret JWT_SECRET 48
gen_secret MINIO_ACCESS_KEY 20
gen_secret MINIO_SECRET_KEY 40
gen_secret GRAFANA_PASSWORD 24
# coturn 与后端共用这一个密钥（compose 里 YUANCHAT_TURN_STATIC_AUTH_SECRET 取的是同一个变量）
gen_secret TURN_SECRET 48
# 管理后台首个账号的初始密码（手机号要用户自己填，见下）
gen_secret ADMIN_PASSWORD 20

# 管理后台没有注册入口：没有管理员账号，装完谁都登不进 admin 子域。
# 手机号无法自动编一个（它是登录账号，也是将来找回密码的凭据），必须用户填。
if [ -z "${ADMIN_PHONE:-}" ]; then
  warn "deploy/.env 的 ADMIN_PHONE 为空 —— 将跳过管理员引导"
  warn "管理后台无注册入口，跳过后需自行注册账号再手工提权（见 docs/deploy/self-hosted.md）"
fi

# ---------- 3. 渲染 nginx.conf 与 coturn 配置 ----------
info "渲染 nginx 配置"
export DOMAIN_APP DOMAIN_API DOMAIN_WS DOMAIN_ADMIN DOMAIN_STORAGE
envsubst '${DOMAIN_APP} ${DOMAIN_API} ${DOMAIN_WS} ${DOMAIN_ADMIN} ${DOMAIN_STORAGE}' \
  < nginx/nginx.conf.template > nginx/nginx.conf

info "渲染 coturn 配置"
export TURN_SECRET PUBLIC_IP
envsubst '${TURN_SECRET} ${DOMAIN_APP} ${PUBLIC_IP}' \
  < coturn/turnserver.prod.conf.template > coturn/turnserver.prod.conf

# ---------- 4. 首次签发证书 ----------
CERT_PATH="./certbot-conf-check"
if ! docker volume inspect yuanchat_certbot_conf >/dev/null 2>&1 || \
   ! docker run --rm -v yuanchat_certbot_conf:/etc/letsencrypt alpine \
       test -d "/etc/letsencrypt/live/${DOMAIN_APP}" 2>/dev/null; then
  info "首次签发 Let's Encrypt 证书"

  # nginx 需要证书才能起 443；先用临时自签证书让它能启动，
  # 通过 80 端口完成 ACME 校验后再换成真证书
  docker run --rm -v yuanchat_certbot_conf:/etc/letsencrypt alpine sh -c "
    apk add --no-cache openssl >/dev/null 2>&1
    for d in ${DOMAIN_APP} ${DOMAIN_API} ${DOMAIN_WS} ${DOMAIN_ADMIN} ${DOMAIN_STORAGE}; do
      mkdir -p /etc/letsencrypt/live/\$d
      openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
        -keyout /etc/letsencrypt/live/\$d/privkey.pem \
        -out /etc/letsencrypt/live/\$d/fullchain.pem \
        -subj '/CN=\$d' >/dev/null 2>&1
    done
  "

  docker compose -f docker-compose.prod.yml up -d nginx
  sleep 5

  for domain in "$DOMAIN_APP" "$DOMAIN_API" "$DOMAIN_WS" "$DOMAIN_ADMIN" "$DOMAIN_STORAGE"; do
    info "签发 $domain"
    # 上面那批自签占位证书占住了 live/<domain>/，而它没有配套的
    # renewal/<domain>.conf，certbot 会判定「live directory exists」直接拒签 ——
    # 报错里完全不提这个目录，很容易误判成 DNS 没生效或 80 端口不可达。
    # 此刻 nginx 已带着占位证书跑起来（进程持有打开的文件句柄，删文件不影响它继续服务），
    # 所以先清掉占位目录再签，签完 reload 就换成真证书。
    docker run --rm -v yuanchat_certbot_conf:/etc/letsencrypt alpine \
      rm -rf "/etc/letsencrypt/live/$domain" "/etc/letsencrypt/archive/$domain" \
             "/etc/letsencrypt/renewal/$domain.conf"
    docker compose -f docker-compose.prod.yml run --rm --entrypoint certbot certbot \
      certonly --webroot -w /var/www/certbot \
      --email "$ADMIN_EMAIL" --agree-tos --no-eff-email \
      --cert-name "$domain" -d "$domain" \
      || die "证书签发失败：确认 $domain 已解析到本机公网 IP 且 80 端口可达"
  done
fi

# ---------- 5. 启动全部服务 ----------
# Web Push 的 VAPID 密钥：没有它后端会静默关掉推送 —— 装完表现为「一切正常，
# 只是永远收不到离线通知」，没人会想到是少了一对密钥。所以在起服务前补上。
# 密钥由镜像里的 /app/genvapid 生成，故先单独构建一次后端镜像（后面 up --build 会命中缓存）。
if [ -z "${VAPID_PUBLIC_KEY:-}" ] || [ -z "${VAPID_PRIVATE_KEY:-}" ]; then
  info "构建后端镜像并生成 Web Push VAPID 密钥"
  docker compose -f docker-compose.prod.yml build yuanchat-server
  vapid="$(docker compose -f docker-compose.prod.yml run --rm --no-deps \
    --entrypoint /app/genvapid yuanchat-server -env 2>/dev/null | tr -d '\r')"
  pub="$(printf '%s\n' "$vapid" | grep '^VAPID_PUBLIC_KEY=' | cut -d= -f2-)"
  prv="$(printf '%s\n' "$vapid" | grep '^VAPID_PRIVATE_KEY=' | cut -d= -f2-)"
  if [ -n "$pub" ] && [ -n "$prv" ]; then
    for pair in "VAPID_PUBLIC_KEY=$pub" "VAPID_PRIVATE_KEY=$prv"; do
      key="${pair%%=*}"
      if grep -q "^${key}=" .env; then
        sed -i "s|^${key}=.*|${pair}|" .env
      else
        printf '%s\n' "$pair" >> .env
      fi
    done
    export VAPID_PUBLIC_KEY="$pub" VAPID_PRIVATE_KEY="$prv"
    info "已生成 VAPID 密钥对并写回 .env"
  else
    warn "VAPID 密钥生成失败，Web Push 将保持关闭（可稍后重跑本脚本补上）"
  fi
fi

info "构建并启动服务（首次构建约 5-10 分钟）"
docker compose -f docker-compose.prod.yml up -d --build

info "等待后端健康检查"
for _ in $(seq 1 60); do
  if docker compose -f docker-compose.prod.yml ps yuanchat-server 2>/dev/null | grep -q healthy; then
    break
  fi
  sleep 3
done

docker compose -f docker-compose.prod.yml exec -T nginx nginx -s reload 2>/dev/null || true

# ---------- 6. 引导管理后台首个账号 ----------
# 放在服务起好之后：这条命令要连库，而库的健康依赖在 compose 里。
# 命令本身幂等 —— 已有管理员就跳过，不会把线上密码重置回 .env 里的值。
if [ -n "${ADMIN_PHONE:-}" ]; then
  info "引导管理后台账号"
  docker compose -f docker-compose.prod.yml run --rm --no-deps \
    --entrypoint /app/bootstrap-admin yuanchat-server || warn "管理员引导失败，可稍后重跑本脚本"
fi

echo
info "部署完成"
echo "  Web 端:     https://${DOMAIN_APP}"
echo "  管理后台:   https://${DOMAIN_ADMIN}"
echo "  API:        https://${DOMAIN_API}"
if [ -n "${ADMIN_PHONE:-}" ]; then
  echo
  echo "管理后台登录：账号 ${ADMIN_PHONE}，密码见 deploy/.env 的 ADMIN_PASSWORD"
  echo "  首次登录后请在应用内改密（改密会吊销旧令牌），并从 .env 里清掉该密码"
fi
echo
echo "后续操作："
echo "  查看日志:   docker compose -f deploy/docker-compose.prod.yml logs -f yuanchat-server"
echo "  启用监控:   docker compose -f deploy/docker-compose.prod.yml --profile observability up -d"
echo "  配置备份:   见 docs/deploy/self-hosted.md「备份」章节"
