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
if [ ! -f .env ]; then
  info "创建 .env（从 .env.prod.example）"
  cp .env.prod.example .env
  warn "请编辑 deploy/.env 填写你的域名与邮箱，然后重新运行本脚本"
  exit 0
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

# PUBLIC_IP 无法自动探测：NAT / 云主机内取到的是内网地址，填错等于没填
# （coturn 会把不可达地址写进 relay candidate，通话卡在「连接中」）。
[ -n "${PUBLIC_IP:-}" ] || die ".env 缺少 PUBLIC_IP（本机外网 IP，coturn 中继必需）
       查看方式：curl -s https://api.ipify.org  或云控制台的公网 IP
       注意不是 ip addr 看到的内网地址"

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
    docker compose -f docker-compose.prod.yml run --rm --entrypoint certbot certbot \
      certonly --webroot -w /var/www/certbot \
      --email "$ADMIN_EMAIL" --agree-tos --no-eff-email \
      --force-renewal -d "$domain" \
      || die "证书签发失败：确认 $domain 已解析到本机公网 IP 且 80 端口可达"
  done
fi

# ---------- 5. 启动全部服务 ----------
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

echo
info "部署完成"
echo "  Web 端:     https://${DOMAIN_APP}"
echo "  管理后台:   https://${DOMAIN_ADMIN}"
echo "  API:        https://${DOMAIN_API}"
echo
echo "后续操作："
echo "  查看日志:   docker compose -f deploy/docker-compose.prod.yml logs -f yuanchat-server"
echo "  启用监控:   docker compose -f deploy/docker-compose.prod.yml --profile observability up -d"
echo "  配置备份:   见 docs/deploy/self-hosted.md「备份」章节"
