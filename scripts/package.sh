#!/usr/bin/env bash
# Build the zip users load unpacked and upload to a store. Runtime files only.
set -euo pipefail
out="${1:-dist/reelflow.zip}"
cd "$(dirname "$0")/.."
mkdir -p "$(dirname "$out")"
rm -f "$out"
zip -rq "$out" manifest.json icons background content popup dashboard -x 'icons/generate_icons.js'
echo "built $out"
