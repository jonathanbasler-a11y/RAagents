#!/bin/sh
# Double-click in Finder to stop the demo started from this folder: the same as "npm run demo:stop".
cd "$(dirname "$0")/../.." || exit 1
for dir in /opt/homebrew/opt/node@24/bin /usr/local/opt/node@24/bin; do
  if [ -x "$dir/node" ]; then PATH="$dir:$PATH"; break; fi
done
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 24 is not installed. See \"Set up once\" in README.md."
  exit 1
fi
node scripts/demo/demo.mjs stop
status=$?
echo
echo "You can close this window."
exit "$status"
