#!/bin/zsh
# Run the complete unsigned-release verification locally.  Packaging is kept
# separate: it is intentionally slow and requires no credentials, while Apple
# Developer signing/notarization remains an owner-controlled release step.
set -euo pipefail

ROOT_DIR="${0:A:h:h}"
cd "${ROOT_DIR}"

npm run license:check
npm run sbom:check
npm run local-only:check
npm run test:ui
npm run test:engine
npm run test:bench
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml

if [[ "${1:-}" == "--package" ]]; then
  npm run tauri:package
  DMG_PATH="${ROOT_DIR}/src-tauri/target/release/bundle/dmg/Philon_0.2.0_aarch64.dmg"
  [[ -f "${DMG_PATH}" ]] || { echo "Expected DMG was not produced: ${DMG_PATH}" >&2; exit 1; }
  hdiutil verify "${DMG_PATH}"
  shasum -a 256 "${DMG_PATH}"
fi
