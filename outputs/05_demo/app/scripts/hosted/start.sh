#!/bin/sh
# Starts the app inside the container image (Dockerfile in the outputs/ folder).
#
# With LITESTREAM_REPLICA_URL set, the chat database (and the accounts in it) survives a redeploy:
# 1. Two copies must never write one backup. A running copy rewrites a heartbeat every 15 seconds, so a backup file newer
#    than a minute means another copy is still writing: stop it first (pause, then update) and this start refuses until then.
# 2. The database is restored from the backup. No backup at that path is an error, so a wrong or changed path cannot
#    quietly start an empty app; only LITESTREAM_ALLOW_EMPTY_START=1, for the very first start, allows an empty start.
# 3. Litestream copies every change to the backup while it runs the server (server.sh) as its child.
# Without it, the server starts on its own and the database lives only as long as the container.
set -eu

db="${CHAT_DB_PATH:?CHAT_DB_PATH must be set to the database file path}"
here="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"

if [ -z "${LITESTREAM_REPLICA_URL:-}" ]; then
  exec /bin/sh "$here/server.sh"
fi
url="$LITESTREAM_REPLICA_URL"
mkdir -p "$(dirname "$db")"

listing="$(litestream ltx -json -level all "$url")"
age="$(printf '%s\n' "$listing" | node "$here/backup-age.mjs")"
if [ "$age" != "none" ] && [ "$age" -lt 60 ]; then
  echo "[hosted] Another copy is still writing this backup (its newest file is ${age} s old). Stop that copy first, wait a minute, then start this one." >&2
  exit 1
fi

existed=0
[ -e "$db" ] && existed=1
if [ "${LITESTREAM_ALLOW_EMPTY_START:-}" = "1" ]; then
  litestream restore -if-db-not-exists -if-replica-exists -integrity-check quick -o "$db" "$url"
else
  litestream restore -if-db-not-exists -integrity-check quick -o "$db" "$url"
fi
if [ "$existed" -eq 1 ]; then
  echo "[hosted] The database file was already there; nothing was restored."
elif [ -e "$db" ]; then
  echo "[hosted] The database is ready, restored from the backup."
else
  echo "[hosted] No backup at this path yet: starting with an empty database (LITESTREAM_ALLOW_EMPTY_START=1). Set it back to 0 after this first start."
fi

exec litestream replicate -exec "/bin/sh '$here/server.sh'" "$db" "$url"
