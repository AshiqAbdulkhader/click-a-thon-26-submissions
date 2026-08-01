#!/usr/bin/env bash
# Reset local Docker state (and optionally run artifacts).
#
# Usage (from source_code/):
#   ./clean-local.sh                 # stop stack, delete volumes, clear artifacts
#   ./clean-local.sh --keep-artifacts
#   ./clean-local.sh --artifacts-only
#
# Does NOT delete source, specs, Parquet data, or backend/.env.
# After clean: ./run-local.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
KEEP_ARTIFACTS=0
ARTIFACTS_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --keep-artifacts) KEEP_ARTIFACTS=1 ;;
    --artifacts-only) ARTIFACTS_ONLY=1 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown flag: $arg" >&2
      exit 1
      ;;
  esac
done

cd "$ROOT"

clear_artifacts() {
  echo "==> Clearing local artifacts / report dist"
  rm -rf backend/artifacts
  rm -rf frontend/dist
  mkdir -p backend/artifacts frontend/dist
  echo "✓ backend/artifacts + frontend/dist cleared"
}

if [[ "$ARTIFACTS_ONLY" -eq 1 ]]; then
  clear_artifacts
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required." >&2
  exit 1
fi

echo "==> Stopping ClickHouse + Langfuse and deleting volumes"
if docker compose --profile langfuse down -v; then
  echo "✓ docker compose --profile langfuse down -v"
else
  echo "✗ docker compose down failed" >&2
  exit 1
fi

if [[ "$KEEP_ARTIFACTS" -eq 0 ]]; then
  clear_artifacts
else
  echo "==> Keeping backend/artifacts and frontend/dist (--keep-artifacts)"
fi

echo ""
echo "Clean complete. Re-run:"
echo "  ./run-local.sh"
echo ""
echo "Langfuse UI (after restart): local@schema-kings.dev / schemakingslocal"
echo "(backend/.env Langfuse keys should still match .env.example)"
