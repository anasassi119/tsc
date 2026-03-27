#!/usr/bin/env bash
# Local end-to-end test: older packaged app sees a newer build via a generic update feed.
#
# Prerequisites: macOS, Python 3 (for http.server), Node/npm deps installed.
#
# Usage (from examples/tsc):
#   ./scripts/test-update-local.sh
#
# What it does:
#   1) Builds the app at the current package.json version ("v1") and copies TSC.app aside.
#   2) Bumps prerelease segment (e.g. 0.0.1-alpha.1 -> 0.0.1-alpha.2), rebuilds ("v2").
#   3) Prints commands to serve release/ and launch the saved v1 app with TSC_UPDATE_TEST_FEED.
#
# After v2 is served, watch Console (or run TSC from Terminal — see below) for:
#   [updates] update available: <new version>
#
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "== Step 1: build v1 (current version from package.json) =="
npm run build:backend
npm run build
npx electron-builder --mac zip --publish never

mkdir -p .update-test
rm -rf .update-test/TSC-v1.app
cp -R release/mac-arm64/TSC.app .update-test/TSC-v1.app
V1="$(node -p "require('./package.json').version")"
echo "Saved v1 app ($V1) -> .update-test/TSC-v1.app"

echo "== Step 2: bump prerelease and build v2 =="
node <<'NODE'
const fs = require('fs')
const p = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const m = /^(.+-alpha\.)(\d+)$/.exec(p.version)
if (!m) {
  throw new Error(
    `Expected version like 0.0.1-alpha.N in package.json; got "${p.version}". Adjust scripts/test-update-local.sh or bump manually.`,
  )
}
p.version = m[1] + (Number(m[2]) + 1)
fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n')
console.log('Bumped version to', p.version)
NODE

npm run build:backend
npm run build
npx electron-builder --mac zip --publish never
V2="$(node -p "require('./package.json').version")"
echo "Built v2 ($V2). latest-mac.yml and zip are under release/"

echo ""
echo "== Step 3: serve the update feed (new terminal, keep running) =="
echo "  cd \"$ROOT/release\" && python3 -m http.server 9876"
echo ""
echo "== Step 4: launch the OLD app with the test feed =="
echo "  TSC_UPDATE_TEST_FEED=http://127.0.0.1:9876/ open -a \"$ROOT/.update-test/TSC-v1.app\""
echo ""
echo "Tip: To see [updates] logs, run the app from Terminal instead of Finder:"
echo "  TSC_UPDATE_TEST_FEED=http://127.0.0.1:9876/ \"$ROOT/.update-test/TSC-v1.app/Contents/MacOS/TSC\""
echo ""
echo "Revert package.json version to $V1 if you need the repo clean:"
echo "  npm version $V1 --no-git-tag-version"
