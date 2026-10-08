#!/bin/sh
# Double-click in Finder to start the practice demo: the same as "npm run demo:practice".
# No VPN needed: replies come from a stand-in model, never to be presented as real answers.
cd "$(dirname "$0")/../.." || exit 1
for dir in /opt/homebrew/opt/node@24/bin /usr/local/opt/node@24/bin; do
  if [ -x "$dir/node" ]; then PATH="$dir:$PATH"; break; fi
done
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 24 is not installed. See \"Set up once\" in README.md."
  exit 1
fi
node scripts/demo/demo.mjs practice
status=$?
echo
if [ "$status" -eq 0 ]; then
  echo "You can close this window. The demo keeps running until you stop it (stop-demo.command)."
else
  echo "The demo did not start: see the message above."
fi
exit "$status"
