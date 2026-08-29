#!/usr/bin/env bash
# Seed CelesTrak space snapshot on NUC (run on NUC after copying files from dev machine).
# Usage from Windows (PowerShell), after generating snapshot locally:
#   scp runs/config/space-snapshot.json runs/config/space-fetch-meta.json runs/config/space-cache.json `
#       asus@192.168.1.241:~/Crucix/runs/config/
# Then on NUC:
#   bash scripts/seed-space-snapshot.sh

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CFG="$ROOT/runs/config"

for f in space-snapshot.json space-fetch-meta.json space-cache.json; do
  if [[ ! -f "$CFG/$f" ]]; then
    echo "Missing $CFG/$f — copy from dev machine first."
    exit 1
  fi
done

echo "Seeded files in $CFG:"
ls -la "$CFG"/space-*.json

if command -v docker >/dev/null 2>&1 && docker compose -f "$ROOT/docker-compose.yml" ps -q crucix >/dev/null 2>&1; then
  echo ""
  echo "Verifying inside container (no CelesTrak network needed)..."
  docker compose -f "$ROOT/docker-compose.yml" exec crucix node -e "
    import { readFileSync } from 'fs';
    const snap = JSON.parse(readFileSync('/app/runs/config/space-snapshot.json','utf8'));
    const p = snap.payload || snap;
    console.log('savedAt:', snap.savedAt);
    console.log('totalNewObjects:', p.totalNewObjects);
    console.log('militarySatellites:', p.militarySatellites);
    console.log('starlink:', p.constellations?.starlink);
  "
  echo ""
  echo "Run full briefing (should use cache, not hit CelesTrak):"
  echo "  docker compose exec crucix node apis/sources/space.mjs"
else
  echo "Container not running — files are on host at $CFG (mounted to /app/runs)."
fi
