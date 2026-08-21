#!/bin/zsh
# Run the complete pre-notarization release verification locally.  Packaging is kept
# separate: it is intentionally slow and requires no credentials, while Apple
# Developer signing/notarization remains an owner-controlled release step.
set -euo pipefail

ROOT_DIR="${0:A:h:h}"
cd "${ROOT_DIR}"

npm run license:check
npm run sbom:check
npm run local-only:check
npm run test:ui
npm run build

# The engine bundle is built before the engine suite runs, so the Apple Vision
# helper exists and the two integration tests execute rather than skipping.
# This is the same order CI uses; without it a local run is quietly weaker than
# the one that gates a release.
npm run engine:package
PHILON_VISION_INTEGRATION=1 npm run test:engine
npm run test:bench

cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml

if [[ "${1:-}" == "--package" ]]; then
  npm run tauri:package
  DMG_PATH="${ROOT_DIR}/src-tauri/target/release/bundle/dmg/Philon_0.2.5_aarch64.dmg"
  [[ -f "${DMG_PATH}" ]] || { echo "Expected DMG was not produced: ${DMG_PATH}" >&2; exit 1; }
  hdiutil verify "${DMG_PATH}"
  shasum -a 256 "${DMG_PATH}"
fi
