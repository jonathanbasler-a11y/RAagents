#!/bin/sh
# Runs the Next.js server for scripts/hosted/start.sh, as Litestream's child when the database is backed up.
#
# On SIGTERM or SIGINT it passes the signal on and waits for the server to finish its shutdown (the app saves running
# turns first). The server then exits with 143 or 130. Litestream v0.5.17 treats any non-zero exit of its child as a
# failure and skips its final upload, which would lose the changes of the last second; a signal exit counts as clean here.
# The keep-alive outlasts the load balancer's 60 s idle timeout, so the balancer never reuses a connection the server closed.
set -u

node node_modules/next/dist/bin/next start -H "${HOST:-0.0.0.0}" -p "${PORT:-8501}" --keepAliveTimeout 65000 &
child=$!
stopping=0
forward() {
  stopping=1
  kill -s "$1" "$child" 2>/dev/null || true
}
trap 'forward TERM' TERM
trap 'forward INT' INT

status=0
wait "$child" || status=$?
# A trapped signal interrupts wait; wait again until the server has really ended.
while kill -0 "$child" 2>/dev/null; do
  status=0
  wait "$child" || status=$?
done
if [ "$stopping" -eq 1 ] && { [ "$status" -eq 143 ] || [ "$status" -eq 130 ]; }; then
  exit 0
fi
exit "$status"
