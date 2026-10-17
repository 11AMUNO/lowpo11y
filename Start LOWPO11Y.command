#!/bin/bash
# Double-click to run LOWPO11Y on this Mac (first run installs and builds; later runs start in seconds).
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js isn't installed. Get the LTS installer from https://nodejs.org, install it, then double-click this file again."
  open "https://nodejs.org" 2>/dev/null
  read -r -p "Press Return to close." _
  exit 1
fi
corepack enable >/dev/null 2>&1 || sudo corepack enable
[ -d node_modules ] || pnpm install || { read -r -p "Install failed (needs internet the first time). Press Return to close." _; exit 1; }
( sleep 8; until curl -s -o /dev/null http://localhost:3000/api/health; do sleep 2; done; open http://localhost:3000 ) &
pnpm offline
