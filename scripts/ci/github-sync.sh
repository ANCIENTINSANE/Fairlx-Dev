#!/bin/bash

# ==============================================================================
# Fairlx GitHub Config Synchronizer
#
# Pushes .env.local into GitHub Actions secrets and variables, using
# .github/workflows/deploy.yml to decide secret vs variable.
#
# Usage: ./scripts/ci/github-sync.sh [.env.local] [--repo=owner/repo]
# ==============================================================================

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

ENV_FILE=".env.local"
REPO_FLAG=""

for arg in "$@"; do
  case "$arg" in
    --repo=*)
      REPO_FLAG="$arg"
      ;;
    --all)
      ;;
    *)
      if [[ "$arg" != --* ]]; then
        ENV_FILE="$arg"
      fi
      ;;
  esac
done

if [[ "$ENV_FILE" != ".env.local" ]]; then
  echo "This sync reads .env.local. Copy your file there or symlink it first."
  exit 1
fi

exec node "$ROOT/scripts/ci/push_env.js" --all ${REPO_FLAG}
