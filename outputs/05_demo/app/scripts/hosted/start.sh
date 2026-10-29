#!/bin/sh
# Starts the app inside the container image (Dockerfile in the outputs/ folder).
#
# With LITESTREAM_REPLICA_URL set, the chat database survives a redeploy: it is restored from
# the replica first (nothing happens when the file already exists or no backup exists yet), then
# Litestream copies every change to the replica while it runs the server as its child process.
# Without it, the server starts on its own and the database lives only as long as the container.
set -eu

db="${CHAT_DB_PATH:?CHAT_DB_PATH must be set to the database file path}"
server="node node_modules/next/dist/bin/next start -H ${HOST:-0.0.0.0} -p ${PORT:-8501}"

if [ -n "${LITESTREAM_REPLICA_URL:-}" ]; then
  mkdir -p "$(dirname "$db")"
  litestream restore -if-db-not-exists -if-replica-exists -o "$db" "$LITESTREAM_REPLICA_URL"
  exec litestream replicate -exec "$server" "$db" "$LITESTREAM_REPLICA_URL"
fi

exec node node_modules/next/dist/bin/next start -H "${HOST:-0.0.0.0}" -p "${PORT:-8501}"
