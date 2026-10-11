#!/usr/bin/env bash
#
# 元聊 YuanChat 生产栈管理 — 一键部署 / 停止 / 更新
#
#   ./deploy/yuanchat.sh deploy          首次部署（生成 .env、签证书、构建并启动）
#   ./deploy/yuanchat.sh start|stop      启停全栈（stop 保留数据卷，不删数据）
#   ./deploy/yuanchat.sh restart
#   ./deploy/yuanchat.sh status          容器与健康状态
#   ./deploy/yuanchat.sh logs [服务名]   跟随日志，省略服务名看全栈
#   ./deploy/yuanchat.sh update          拉代码 → 对齐 APP_VERSION → 重建并滚动重启
#   ./deploy/yuanchat.sh monitor on|off  按需开关 Prometheus/Grafana/Loki
#   ./deploy/yuanchat.sh backup          调用 backup.sh 备份 PG + MinIO
#
# 数据安全：本脚本不提供删卷入口。要清库请手动 `docker compose ... down -v`，
# 那会连 PostgreSQL 与 MinIO 的数据一起删掉。

set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

GREEN=$'\033[0;32m'; RED=$'\033[0;31m'; NC=$'\033[0m'
info() { echo "${GREEN}==>${NC} $*"; }
die()  { echo "${RED}错误:${NC} $*" >&2; exit 1; }

COMPOSE=(docker compose -f docker-compose.prod.yml)

[ -f .env ] || [ "${1:-}" = "deploy" ] || die "缺少 deploy/.env，先跑 ./deploy/yuanchat.sh deploy"

# 镜像 tag 取自 .env 的 APP_VERSION；与仓库版本号脱节会导致 compose
# 去找一个根本没构建过的 tag，于是「更新完还是旧代码」。update 时强制对齐。
sync_app_version() {
  local repo_version
  repo_version="$(node -p "require('../package.json').version" 2>/dev/null \
    || grep -m1 '"version"' ../package.json | sed 's/.*"version": *"\([^"]*\)".*/\1/')"
  [ -n "$repo_version" ] || die "读不到 package.json 的 version"
  if grep -q '^APP_VERSION=' .env; then
    sed -i "s|^APP_VERSION=.*|APP_VERSION=${repo_version}|" .env
  else
    printf 'APP_VERSION=%s\n' "$repo_version" >> .env
  fi
  info "APP_VERSION 已对齐为 ${repo_version}"
}

case "${1:-}" in
  deploy)
    ./install.sh
    ;;
  start)
    "${COMPOSE[@]}" up -d
    "${COMPOSE[@]}" ps
    ;;
  stop)
    # down 而非 stop：顺带清掉网络与孤立容器，命名卷（pg/minio/certbot）不受影响
    "${COMPOSE[@]}" down
    info "已停止，数据卷保留"
    ;;
  restart)
    "${COMPOSE[@]}" restart
    ;;
  status)
    "${COMPOSE[@]}" ps
    echo
    df -hT / /www 2>/dev/null | grep -v tmpfs || true
    free -h | head -2
    ;;
  logs)
    shift
    "${COMPOSE[@]}" logs -f --tail=200 "$@"
    ;;
  update)
    info "拉取最新代码"
    git -C .. pull --ff-only
    sync_app_version
    info "重建并滚动重启（前端镜像把域名编译进包里，域名变了也要走这条）"
    "${COMPOSE[@]}" up -d --build
    "${COMPOSE[@]}" exec -T nginx nginx -s reload 2>/dev/null || true
    "${COMPOSE[@]}" ps
    ;;
  monitor)
    case "${2:-}" in
      on)  "${COMPOSE[@]}" --profile observability up -d ;;
      off) "${COMPOSE[@]}" --profile observability stop prometheus grafana loki ;;
      *)   die "用法：$0 monitor on|off" ;;
    esac
    ;;
  backup)
    ./backup.sh
    ;;
  *)
    sed -n '3,20p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
