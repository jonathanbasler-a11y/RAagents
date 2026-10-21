#!/bin/sh
# Double-click to run this step of the demo. Tiny on purpose: it picks the Node.js that
# ships in this folder for this Mac and hands over to the launcher.
cd "$(dirname "$0")" || exit 1
# A bare PATH may lack the folder that holds sysctl; add it behind the existing entries.
PATH="$PATH:/usr/sbin:/sbin"
# Remove the "downloaded from the internet" mark from this folder so the Mac does not
# ask again for every file in it. Errors are ignored.
xattr -dr com.apple.quarantine . 2>/dev/null
if [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = "1" ]; then
  NODE="runtime/darwin-arm64/bin/node"
else
  NODE="runtime/darwin-x64/bin/node"
fi
exitcode=1
if [ ! -f "$NODE" ] || [ ! -f "launcher/bundle/launcher.mjs" ]; then
  echo "Part of the demo is missing. Unzip the whole ZIP again and open this file from the unzipped folder."
else
  chmod +x "$NODE" 2>/dev/null
  echo "Starting the practice demo (stand-in replies, no key needed)..."
  "$NODE" "launcher/bundle/launcher.mjs" practice
  exitcode=$?
fi
echo
if [ "$exitcode" -ne 0 ]; then
  echo "The practice demo did not start. Read the message above."
  echo
fi
printf 'Press Return to close this window. '
read -r _answer
exit "$exitcode"
