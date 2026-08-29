#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"

for package_dir in backend frontend; do
  echo "Validating production audit in $package_dir"
  (
    cd "$repo_root/$package_dir"
    npm ci
    npm audit --omit=dev
  )
done

echo "Production dependency audits passed."
