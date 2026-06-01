#!/usr/bin/env bash
# Dump the control-server Postgres and upload to Google Drive via rclone.
# Installed on the control server at /opt/rmg-creator-os/backup-db.sh and run by cron.
# Requires rclone configured with a "gdrive" remote (see infra/control-server/README.md).
set -euo pipefail
export PATH=/usr/local/bin:/usr/bin:/bin
STACK=/opt/rmg-creator-os/control-server
LOG=/var/log/rmg-db-backup.log
TS=$(date +%F_%H%M%S)
TMP=$(mktemp -d)
OUT="$TMP/rmgcreator_${TS}.sql.gz"
cd "$STACK"
docker compose exec -T db pg_dump -U rmgcreator rmgcreator | gzip > "$OUT"
SIZE=$(du -h "$OUT" | cut -f1)
rclone copy "$OUT" gdrive:rmg-backups/
rclone delete gdrive:rmg-backups/ --min-age 30d || true   # 30-day retention
rm -rf "$TMP"
echo "$(date -Is) OK $(basename "$OUT") ($SIZE)" >> "$LOG"
