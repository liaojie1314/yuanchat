#!/usr/bin/env bash
#
# 元聊 YuanChat 每日备份：PostgreSQL 全量 dump + MinIO 对象同步
#
# 手动执行：./deploy/backup.sh
# 定时执行（每日 3:00）：
#   sudo crontab -e
#   0 3 * * * /path/to/yuanchat/deploy/backup.sh >> /var/log/yuanchat-backup.log 2>&1
#
# 保留策略：默认保留最近 7 份（BACKUP_KEEP 可覆盖）。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# shellcheck disable=SC1091
set -a; source .env; set +a

BACKUP_DIR="${BACKUP_DIR:-$SCRIPT_DIR/backups}"
BACKUP_KEEP="${BACKUP_KEEP:-7}"
STAMP="$(date +%Y%m%d-%H%M%S)"
COMPOSE="docker compose -f $SCRIPT_DIR/docker-compose.prod.yml"

mkdir -p "$BACKUP_DIR"

echo "==> [$STAMP] 备份 PostgreSQL"
$COMPOSE exec -T postgres pg_dump -U "$DB_USER" -d "$DB_NAME" --clean --if-exists \
  | gzip > "$BACKUP_DIR/pg-$STAMP.sql.gz"

echo "==> [$STAMP] 备份 MinIO 对象"
# mc 镜像直接挂载 minio 数据卷做归档（无需在宿主机装 mc）
docker run --rm \
  -v yuanchat_minio_data:/data:ro \
  -v "$BACKUP_DIR":/backup \
  alpine tar czf "/backup/minio-$STAMP.tar.gz" -C /data .

echo "==> 清理超过 $BACKUP_KEEP 份的旧备份"
ls -1t "$BACKUP_DIR"/pg-*.sql.gz 2>/dev/null | tail -n "+$((BACKUP_KEEP + 1))" | xargs -r rm -f
ls -1t "$BACKUP_DIR"/minio-*.tar.gz 2>/dev/null | tail -n "+$((BACKUP_KEEP + 1))" | xargs -r rm -f

echo "==> 备份完成："
ls -lh "$BACKUP_DIR" | tail -n 5

# 恢复步骤见 docs/deploy/self-hosted.md「灾难恢复」
